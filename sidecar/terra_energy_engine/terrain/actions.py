"""
The usable-ground action: the request it accepts, the elevation model it
reads, and the layer and figures it answers with.

The arithmetic is in terrain/usable.py, which reads no catalogue. This module
is the part that does: it fetches the Copernicus DEM over the area and its
drainage buffer, runs slope and HAND over the whole window, and crops back to
the area before anything is counted or drawn.
"""

from __future__ import annotations

from terra_energy_engine import protocol


def request_rules(req: protocol.Request) -> tuple[float, float]:
    """
    The two rules, refused when they could not exclude anything sensibly.

    A HAND minimum of zero is accepted: it switches the flood rule off, which
    is a question a reader may ask. A slope maximum of zero is not, because it
    would exclude every cell that is not exactly level.
    """
    from terra_energy_engine.terrain import usable

    slope_max = protocol.request_positive(req, 'slope_max_deg', usable.SLOPE_MAX_DEG)
    if slope_max > 90:
        protocol.fail(f'slope_max_deg must be at most 90, got {slope_max}')
    hand_min = protocol.request_positive(req, 'hand_min_m', usable.HAND_MIN_M, allow_zero=True)
    return slope_max, hand_min


def usable_ground(req: protocol.Request) -> None:
    from pathlib import Path

    import numpy as np
    import rasterio
    from rasterio.features import geometry_mask

    from terra_energy_engine.energy import actions as energy_actions
    from terra_energy_engine.imagery import cog, composite as comp, grid as ref_grid
    from terra_energy_engine.terrain import (
        dem as terrain_dem,
        hand as terrain_hand,
        slope as terrain_slope,
        usable,
        water as terrain_water,
    )
    from terra_energy_engine import stac

    work_dir = req.get('work_dir')
    if not work_dir:
        protocol.fail('the request names no work_dir for the rendered layer')
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    slope_max, hand_min = request_rules(req)

    # The buffer follows the area (terrain/dem.py argues why), so the bound on
    # the window is checked with the largest it can be and the read uses the
    # one this area gets.
    polygon = energy_actions.request_area(
        req, terrain_dem.BUFFER_MAX_M,
        product='the usable ground product', margin='the drainage buffer',
    )
    buffer_m = terrain_dem.recommended_buffer_m(polygon.bounds)

    cog.configure()
    protocol.emit_progress(5, 'fetching Copernicus DEM GLO-30')
    try:
        # Coverage is not required: a coastal area has no tile over the sea,
        # and those cells are reported as carrying no elevation.
        dem_path = terrain_dem.fetch_file(
            polygon, work_dir / 'dem.tif', buffer_m=buffer_m,
            progress=lambda msg: protocol.emit_progress(-1, msg),
        )
    except Exception as e:
        protocol.fail(f'DEM fetch failed: {e}')

    with rasterio.open(dem_path) as src:
        raw = src.read(1)
        buf_transform = src.transform
        dem_crs = src.crs
        profile = src.profile.copy()
        window = rasterio.windows.from_bounds(
            *polygon.bounds, transform=buf_transform
        ).round_offsets().round_lengths().intersection(
            rasterio.windows.Window(0, 0, src.width, src.height)
        )

    has_elevation = np.isfinite(raw)
    try:
        elevation = usable.fill_gaps(raw)
    except ValueError as e:
        protocol.fail(str(e))

    lat = polygon.centroid.y
    protocol.emit_progress(30, 'slope')
    # Each module's own cell size, as terrain/slope.py explains: the slope is
    # the one solar terrain reports over the same ground.
    sx, sy = terrain_slope.pixel_size_m(buf_transform, lat)
    slope, _ = terrain_slope.horn_slope_aspect(elevation, sx, sy)

    protocol.emit_progress(45, 'height above the nearest drainage')
    dx, dy = terrain_hand.pixel_size_m(lat, abs(buf_transform.a), abs(buf_transform.e))
    try:
        chain = terrain_hand.compute(elevation, dx, dy, drainage_km2=usable.DRAINAGE_KM2)
    except ValueError as e:
        protocol.fail(f'the drainage could not be traced: {e}')
    height = chain['hand']

    # Crop back: the buffer exists so the drainage entering the area is real
    # terrain, not so the result reports on ground nobody asked about.
    r0, c0 = int(window.row_off), int(window.col_off)
    r1, c1 = r0 + int(window.height), c0 + int(window.width)
    if r1 <= r0 or c1 <= c0:
        protocol.fail('the DEM window does not overlap the area')
    slope, height = slope[r0:r1, c0:c1], height[r0:r1, c0:c1]
    has_elevation = has_elevation[r0:r1, c0:c1]
    transform = rasterio.windows.transform(window, buf_transform)

    inside = ~geometry_mask(
        [polygon.__geo_interface__], out_shape=slope.shape,
        transform=transform, invert=False,
    )
    measured = inside & has_elevation
    if not measured.any():
        protocol.fail('no cell of the area carries an elevation')

    protocol.emit_progress(70, 'permanent water')
    try:
        # Over the area alone: the mask is applied after the crop, and the
        # drainage has no use for it.
        water, mapped = terrain_water.mask(
            transform, slope.shape, dem_crs,
            progress=lambda msg: protocol.emit_progress(-1, msg),
        )
    except stac.Unavailable as e:
        # Not run without it: the result would count the sea as ground that
        # floods, which is the answer this mask exists to stop.
        protocol.fail(f'the water map could not be read: {e}')
    except Exception as e:
        protocol.fail(f'the water map could not be read: {e}')
    water_known = bool((mapped & measured).any())

    protocol.emit_progress(88, 'counting the ground by rule')
    cell_km2 = dx * dy / 1e6
    summary = usable.summarise(slope, height, measured, cell_km2, slope_max, hand_min, water)
    classes = usable.classify(slope, height, slope_max, hand_min, water)

    png = work_dir / 'usable_ground.png'
    comp.write_rgba_png(usable.rgba(classes, measured), png)

    tif = work_dir / 'usable_ground.tif'
    profile.update(
        height=classes.shape[0], width=classes.shape[1], transform=transform,
        dtype='uint8', count=1, compress='lzw', nodata=usable.NO_DATA,
    )
    with rasterio.open(tif, 'w', **profile) as dst:
        dst.write(np.where(measured, classes, usable.NO_DATA).astype('uint8'), 1)

    lon_min, lon_max, lat_min, lat_max = ref_grid.get_map_extent(
        {'transform': transform, 'crs': dem_crs,
         'height': classes.shape[0], 'width': classes.shape[1]}
    )
    protocol.emit_progress(100, 'done')
    protocol.reply({
        'usable_ground': {
            **summary,
            'rules': {
                'slope_max_deg': slope_max,
                'hand_min_m': hand_min,
                'drainage_km2': usable.DRAINAGE_KM2,
            },
            # Inside the area and without an elevation: sea, or a void in the
            # model. Not judged, so in no share above.
            'no_data_km2': round(float((inside & ~has_elevation).sum()) * cell_km2, 4),
            'cell_m': [round(dx, 2), round(dy, 2)],
            'buffer_m': round(buffer_m, 1),
            'dem_source': 'Copernicus DEM GLO-30',
            'water': {
                'source': terrain_water.SOURCE,
                'attribution': terrain_water.ATTRIBUTION,
                # Whether the map classifies any of this area. Where it does
                # not, no cell is water and the caveat says why.
                'mapped': water_known,
                # Measured ground the map does not classify: counted as land.
                'unmapped_km2': round(float((measured & ~mapped).sum()) * cell_km2, 4),
            },
            'caveats': {
                'hand': usable.HAND_CAVEAT.format(buffer_km=buffer_m / 1000.0),
                'water': terrain_water.PERMANENT_WATER_NOTE if water_known else terrain_water.NO_MAP_NOTE,
            },
            'overlay_png': str(png),
            'raster_tif': str(tif),
            'extent': {
                'lon_min': lon_min, 'lat_min': lat_min,
                'lon_max': lon_max, 'lat_max': lat_max,
            },
        }
    })
