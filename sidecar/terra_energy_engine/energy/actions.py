"""
The energy actions: the solar resource and the wind screening at a site.

Ported from TERRA's terra/energy/actions.py. The computation is TERRA's,
unchanged; what differs is the input. TERRA takes a polygon and reads its
centroid, and this takes the site itself as a longitude and latitude, because
the resource at a point is what both products report and this application has
no area to take a centroid of yet.

Each action reads its request, runs the product, and writes one JSON object to
stdout. The heavy imports are deferred into the function bodies, so a request
for one action does not pay for the other's dependencies.
"""

from __future__ import annotations

import math

from terra_energy_engine import protocol

# Defaults of the solar and terrain parameters a caller may omit. Module
# constants rather than literals at the call sites, because parameter_defaults
# reports them to the interface: a default the interface showed from its own
# copy would drift from the one the run applied, and nothing would say so. The
# wind defaults already live in energy/wind.py and are read from there.
SOLAR_CLIMATOLOGY_YEARS = 30
SOLAR_HOURLY_YEARS = 10
# Degrees from north. Zero faces the equator in the southern hemisphere.
SOLAR_SURFACE_AZIMUTH = 0.0
TERRAIN_HOURLY_YEARS = 10
TERRAIN_SEASON = 'annual'
# The terrain windows that are not month tables in energy/seasons.py: the
# winter-over-summer ratio and the share of beam irradiation the horizon blocks.
TERRAIN_DERIVED_SEASONS = ('anisotropy', 'shading')


def request_site(req: protocol.Request) -> tuple[float, float]:
    """The site as (lon, lat) in degrees, refused when absent or off the globe."""
    try:
        lon = float(req['lon'])
        lat = float(req['lat'])
    except (KeyError, TypeError, ValueError):
        protocol.fail('the request needs the site as lon and lat, in degrees')
    if not (math.isfinite(lon) and math.isfinite(lat)
            and -180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0):
        protocol.fail(f'{lon}, {lat} is not a longitude and latitude')
    return lon, lat


def request_performance_ratio(req: protocol.Request) -> float | None:
    """
    The caller's performance ratio, or None to apply the reference one.

    Refused unless it lies in (0, 1]. A boolean is refused too: Python counts
    True as the integer 1, and a ratio of 1.0 is not what anyone sending a flag
    meant.
    """
    value = req.get('performance_ratio')
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 < value <= 1:
        protocol.fail(f'performance_ratio must be a number in (0, 1], got {value!r}')
    return float(value)


# Solar resource and photovoltaic yield at the site (no imagery).
def solar_resource(req: protocol.Request) -> None:
    from datetime import date as _date

    import numpy as np

    from terra_energy_engine.energy import pv as pv_mod
    from terra_energy_engine.sun import (
        cache as power_cache,
        nasa_power as sun_power,
        position as sun_position,
        record as sun_record,
    )

    site_lon, site_lat = request_site(req)
    lon, lat = sun_power.request_point(site_lon, site_lat)

    clim_years = protocol.request_positive(
        req, 'climatology_years', SOLAR_CLIMATOLOGY_YEARS, int
    )
    hourly_years = protocol.request_positive(req, 'hourly_years', SOLAR_HOURLY_YEARS, int)
    # Zero is due north here, which is both the default and a value the
    # caller can mean, so absence is what selects the default.
    azimuth = protocol.request_number(req, 'surface_azimuth', SOLAR_SURFACE_AZIMUTH)
    pr_override = request_performance_ratio(req)

    # POWER publishes through the previous full year.
    last_year = _date.today().year - 1
    clim_start = f'{last_year - clim_years + 1}0101'
    clim_end = f'{last_year}1231'
    hourly_start = f'{last_year - hourly_years + 1}0101'
    hourly_end = f'{last_year}1231'

    cache = power_cache.power_cache_dir(req)
    protocol.emit_progress(5, f'NASA POWER daily, {clim_years} years')
    try:
        daily, daily_provenance = power_cache.cached_power_series(
            cache, 'daily', lon, lat, clim_start, clim_end,
            sun_power.DAILY_PARAMS,
            lambda progress: sun_power.fetch(
                'daily', lon, lat, clim_start, clim_end, progress=progress
            ),
            progress=lambda i, n, y: protocol.emit_progress(
                5 + int(35 * (i + 1) / n), f'daily {y}'
            ),
        )
    except Exception as e:
        protocol.fail(f'NASA POWER daily request failed: {e}')

    annual = sun_record.annual_totals(daily)
    if annual.empty:
        protocol.fail('NASA POWER returned no complete year for this point')
    slope, pvalue = sun_record.linear_trend(annual)
    resource = {
        'ghi_annual_kwh_m2': round(float(annual.mean()), 1),
        'ghi_std': round(float(annual.std(ddof=1)), 1) if annual.size > 1 else 0.0,
        'ghi_cv_pct': (
            round(float(100.0 * annual.std(ddof=1) / annual.mean()), 2)
            if annual.size > 1 and annual.mean() else 0.0
        ),
        'ghi_p10': round(float(np.percentile(annual.values, 10)), 1),
        'ghi_p90': round(float(np.percentile(annual.values, 90)), 1),
        'n_years': int(annual.size),
        'trend_per_year': round(slope, 3),
        'trend_p_value': round(pvalue, 4),
        'clear_sky_index': sun_record.clear_sky_index(daily),
        'monthly': sun_record.monthly_climatology(daily),
    }

    protocol.emit_progress(42, f'NASA POWER hourly, {hourly_years} years')
    try:
        hourly, hourly_provenance = power_cache.cached_power_series(
            cache, 'hourly', lon, lat, hourly_start, hourly_end,
            sun_power.HOURLY_PARAMS,
            lambda progress: sun_power.fetch(
                'hourly', lon, lat, hourly_start, hourly_end,
                progress=progress,
            ),
            progress=lambda i, n, y: protocol.emit_progress(
                42 + int(38 * (i + 1) / n), f'hourly {y}'
            ),
        )
    except Exception as e:
        protocol.fail(f'NASA POWER hourly request failed: {e}')

    df, solpos = sun_position.prepare_hourly(hourly, lat, lon, 0.0)
    if df.empty:
        protocol.fail('NASA POWER returned no usable hourly record for this point')
    n_years = max(len(set(df.index.year)), 1)

    protocol.emit_progress(84, 'optimum tilt')
    sweep = pv_mod.sweep_tilt(df, solpos, azimuth, n_years)
    best = max(sweep, key=lambda r: r['poa_kwh_m2_year'])
    horizontal = next(
        (r['poa_kwh_m2_year'] for r in sweep if abs(r['tilt_deg']) < 1e-9),
        best['poa_kwh_m2_year'],
    )
    tolerance = []
    for dev in (5.0, 10.0, 15.0):
        near = [
            r for r in sweep
            if abs(abs(r['tilt_deg'] - best['tilt_deg']) - dev) < 0.26
        ]
        if near:
            worst = min(near, key=lambda r: r['poa_kwh_m2_year'])
            loss = 100.0 * (1.0 - worst['poa_kwh_m2_year'] / best['poa_kwh_m2_year'])
            tolerance.append({
                'deviation_deg': dev, 'loss_pct': round(float(loss), 2)
            })

    protocol.emit_progress(92, 'photovoltaic yield')
    poa = pv_mod.transpose(df, solpos, best['tilt_deg'], azimuth)
    p_ac = pv_mod.pv_yield(poa, df, solpos, best['tilt_deg'], azimuth)
    pr_modelled = pv_mod.modelled_performance_ratio(p_ac, poa['poa_global'])
    pr_applied = pr_override if pr_override is not None else pv_mod.REFERENCE_PERFORMANCE_RATIO
    pr_source = 'user' if pr_override is not None else 'reference'
    poa_year = float(poa['poa_global'].sum()) / 1000.0 / n_years
    # Specific yield is POA times the performance ratio by construction, so
    # applying a reference ratio is exact rather than a correction factor.
    yield_year = poa_year * pr_applied

    protocol.emit_progress(100, 'done')
    summary = pv_mod.summarise_point(
        best, horizontal, tolerance, azimuth,
        yield_year=yield_year, pr_applied=pr_applied, pr_source=pr_source,
        pr_modelled=pr_modelled, n_years=n_years,
    )
    protocol.reply({
        'solar': {
            'lon': lon, 'lat': lat,
            'resource': resource,
            **summary,
            'grid_note': sun_power.GRID_NOTE,
            # Which POWER series this run read and when it was fetched. Without
            # it a cached run and a fetched run are indistinguishable to the
            # caller, and POWER reprocesses historical data.
            'power_provenance': {
                'daily': daily_provenance,
                'hourly': hourly_provenance,
            },
        }
    })


# Wind resource screening at the site, from POWER hourly MERRA-2.
def wind_resource(req: protocol.Request) -> None:
    from datetime import date as _date

    from terra_energy_engine.energy import wind as wind_mod
    from terra_energy_engine.sun import cache as power_cache, nasa_power as sun_power

    site_lon, site_lat = request_site(req)
    # The MERRA-2 cell centre, not the site: the request resolves to a cell
    # and the response has to say which cell it describes.
    lon, lat = sun_power.meteorology_cell(site_lon, site_lat)

    record_years = protocol.request_positive(
        req, 'record_years', wind_mod.RECORD_YEARS, int
    )
    hub_height_m = protocol.request_positive(
        req, 'hub_height_m', wind_mod.HUB_HEIGHT_M
    )
    # Zero is a caller stating that no hour counts as calm, and zero is a
    # caller stating that the record maximum needs no floor. Both are
    # values; only absence selects the wind module's convention.
    calm_threshold = protocol.request_positive(
        req, 'calm_threshold_ms', wind_mod.CALM_THRESHOLD_MS,
        allow_zero=True,
    )
    record_max_floor = protocol.request_positive(
        req, 'record_max_floor_ms', wind_mod.RECORD_MAX_FLOOR_MS,
        allow_zero=True,
    )
    band = req.get('roughness_band_m') or wind_mod.ROUGHNESS_BAND_M
    try:
        roughness_band = (float(band[0]), float(band[1]))
    except (TypeError, IndexError, ValueError):
        protocol.fail('roughness_band_m must be two roughness lengths in metres')

    last_year = _date.today().year - 1
    start, end = wind_mod.record_period(last_year, record_years)
    record_window = f'{start[:4]}-{end[:4]} hourly'

    protocol.emit_progress(5, f'NASA POWER hourly wind, {record_years} years')
    try:
        df, hourly_provenance = power_cache.cached_power_series(
            power_cache.power_cache_dir(req), 'hourly', lon, lat, start, end,
            wind_mod.HOURLY_PARAMS,
            lambda progress: wind_mod.fetch(
                lon, lat, start, end, progress=progress
            ),
            progress=lambda i, n, y: protocol.emit_progress(
                5 + int(80 * (i + 1) / n), f'hourly {y}'
            ),
        )
    except Exception as e:
        protocol.fail(f'NASA POWER hourly request failed: {e}')
    if df.empty:
        protocol.fail('NASA POWER returned no hourly record for this point')

    protocol.emit_progress(90, 'shear, Weibull fit and turbine power')
    try:
        assessment = wind_mod.assess(
            df, lon, lat,
            hub_height_m=hub_height_m,
            calm_threshold_ms=calm_threshold,
            record_max_floor_ms=record_max_floor,
            roughness_band_m=roughness_band,
        )
    except Exception as e:
        protocol.fail(f'wind assessment failed: {e}')

    assessment.update({
        'lon': lon, 'lat': lat,
        'record_window': record_window,
        'hub_height_m': hub_height_m,
        # Whether the POWER record behind this assessment was fetched or
        # read from the on-disk cache, and when it was fetched.
        'power_provenance': {'hourly': hourly_provenance},
        'assumptions': {
            'hub_height_m': hub_height_m,
            'hub_height_source': (
                'Hub height of the IEA-3.4-130 reference turbine, applied '
                'as a project convention. No turbine has been selected for '
                'this site.'
            ),
            'record_years': record_years,
            'record_window': record_window,
            'shear_exponent': assessment['measured']['shear_exponent'],
            'shear_exponent_source': (
                'Power law between the 10 m and 50 m long-term means of '
                'this record. Everything above 50 m is extrapolated.'
            ),
            'roughness_band_m': list(roughness_band),
            'calm_threshold_ms': calm_threshold,
            'record_max_floor_ms': record_max_floor,
            'qualifier': wind_mod.RESULT_QUALIFIER,
            'excluded_losses': list(wind_mod.EXCLUDED_LOSSES),
            'comparison_note': (
                'The gross capacity factor here and the photovoltaic '
                'capacity factor from solar_resource are not comparable. '
                'The photovoltaic figure is computed at a performance '
                'ratio benchmarked against the Global Solar Atlas; this '
                'one carries no external validation and no plant losses.'
            ),
        },
    })

    protocol.emit_progress(100, 'done')
    protocol.reply({'wind': assessment})


# The terrain product reads an elevation model over the area plus a margin, and
# the horizon trace holds sixteen float32 values per cell of it: 256 MB for that
# array alone at four million cells, which at the 30 m grid is about 55 by 55 km
# of ground once the margin is added. TERRA had no bound here.
MAX_DEM_CELLS = 4_000_000
DEM_CELL_M = 30.0


def request_area(
    req: protocol.Request,
    margin_m: float,
    product: str = 'the terrain product',
    margin: str = 'the horizon margin',
):
    """
    The area as a shapely polygon, refused before any download when it cannot
    be computed: not a polygon, an outline that crosses itself, or more ground
    than the horizon trace can hold.

    `product` and `margin` name, in the refusal, who is asking and what the
    margin is for: usable ground reads the same elevation model under the same
    bound, with a drainage buffer where this product has a horizon.
    """
    from terra_energy_engine import aoi

    geom = req.get('polygon_geojson')
    if not geom:
        protocol.fail('the request has no area (polygon_geojson)')
    try:
        polygon = aoi.polygon_from_geojson(geom)
    except Exception as e:
        protocol.fail(f'the area could not be read: {e}')
    if polygon.geom_type != 'Polygon' or polygon.is_empty:
        protocol.fail('the area must be a single polygon')
    if not polygon.is_valid:
        protocol.fail('the area outline crosses itself; draw it again')

    minx, miny, maxx, maxy = polygon.bounds
    mid_lat = math.radians((miny + maxy) / 2.0)
    width_m = (maxx - minx) * 111_320.0 * math.cos(mid_lat) + 2.0 * margin_m
    height_m = (maxy - miny) * 110_540.0 + 2.0 * margin_m
    cells = (width_m / DEM_CELL_M) * (height_m / DEM_CELL_M)
    if cells > MAX_DEM_CELLS:
        protocol.fail(
            f'the area is too large for {product}: about '
            f'{cells / 1e6:.1f} million elevation cells with {margin}, '
            f'against a limit of {MAX_DEM_CELLS / 1e6:.0f} million '
            f'(roughly 55 by 55 km)'
        )
    return polygon


def request_season(req: protocol.Request) -> str:
    """
    The terrain window, lower-cased, refused unless solar_terrain can compute
    it. Absence selects TERRAIN_SEASON.
    """
    from terra_energy_engine.energy import seasons as seasons_mod

    season = str(req.get('season') or TERRAIN_SEASON).lower()
    if season not in seasons_mod.SEASONS and season not in TERRAIN_DERIVED_SEASONS:
        protocol.fail(f'unknown season: {season}')
    return season


# Terrain-resolved plane-of-array irradiation over the area. Ported from TERRA's
# solar_terrain; the additions are the area checks above, the work_dir taken
# from the request, and the palette stops sent with the scale.
def solar_terrain(req: protocol.Request) -> None:
    from datetime import date as _date
    from pathlib import Path

    import numpy as np
    import rasterio
    from rasterio.features import geometry_mask

    from terra_energy_engine.energy import (
        overlays as overlays_mod,
        seasons as seasons_mod,
        terrain_irradiance as poa_mod,
    )
    from terra_energy_engine.imagery import cog, composite as comp, grid as ref_grid
    from terra_energy_engine.sun import (
        cache as power_cache,
        nasa_power as sun_power,
        position as sun_position,
        record as sun_record,
    )
    from terra_energy_engine.terrain import dem as terrain_dem, slope as terrain_slope

    work_dir = req.get('work_dir')
    if not work_dir:
        protocol.fail('the request names no work_dir for the rendered layer')
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    polygon = request_area(req, poa_mod.HORIZON_MAX_DIST_M)
    season = request_season(req)
    hourly_years = protocol.request_positive(req, 'hourly_years', TERRAIN_HOURLY_YEARS, int)

    cog.configure()
    centroid = polygon.centroid
    lon, lat = sun_power.request_point(centroid.x, centroid.y)
    last_year = _date.today().year - 1

    protocol.emit_progress(5, 'fetching Copernicus DEM GLO-30')
    try:
        # Buffered, so terrain just outside the area can still cast onto
        # pixels inside it. Everything downstream is cropped back to the
        # area's window before it is published.
        dem_path = terrain_dem.fetch_file(
            polygon, work_dir / 'dem.tif',
            buffer_m=poa_mod.HORIZON_MAX_DIST_M,
            progress=lambda msg: protocol.emit_progress(-1, msg),
        )
    except Exception as e:
        protocol.fail(f'DEM fetch failed: {e}')

    with rasterio.open(dem_path) as src:
        elevation = src.read(1).astype(float)
        buf_transform = src.transform
        dem_crs = src.crs
        buf_profile = src.profile.copy()
        aoi_window = rasterio.windows.from_bounds(
            *polygon.bounds, transform=buf_transform
        ).round_offsets().round_lengths().intersection(
            rasterio.windows.Window(0, 0, src.width, src.height)
        )

    dx_m, dy_m = terrain_slope.pixel_size_m(buf_transform, lat)
    protocol.emit_progress(20, 'slope, aspect and horizon')
    slope, aspect = terrain_slope.horn_slope_aspect(elevation, dx_m, dy_m)
    horizon, _ = poa_mod.horizon_angles(elevation, dx_m, dy_m)

    # Crop back: the buffer exists so the horizon sees beyond the boundary,
    # not so the result reports on land the user did not ask about.
    r0 = int(aoi_window.row_off)
    c0 = int(aoi_window.col_off)
    r1 = r0 + int(aoi_window.height)
    c1 = c0 + int(aoi_window.width)
    if r1 <= r0 or c1 <= c0:
        protocol.fail('the DEM window does not overlap the area')

    def _crop(a):
        return a[r0:r1, c0:c1]

    elevation = _crop(elevation)
    slope, aspect = _crop(slope), _crop(aspect)
    horizon = horizon[r0:r1, c0:c1, :]
    dem_transform = rasterio.windows.transform(aoi_window, buf_transform)
    dem_profile = buf_profile.copy()
    dem_profile.update(height=slope.shape[0], width=slope.shape[1],
                       transform=dem_transform)

    hourly_start = f'{last_year - hourly_years + 1}0101'
    hourly_end = f'{last_year}1231'
    protocol.emit_progress(28, f'NASA POWER hourly, {hourly_years} years')
    try:
        hourly, hourly_provenance = power_cache.cached_power_series(
            power_cache.power_cache_dir(req), 'hourly', lon, lat,
            hourly_start, hourly_end, sun_power.HOURLY_PARAMS,
            lambda progress: sun_power.fetch(
                'hourly', lon, lat, hourly_start, hourly_end,
                progress=progress,
            ),
            progress=lambda i, n, y: protocol.emit_progress(
                28 + int(45 * (i + 1) / n), f'hourly {y}'
            ),
        )
    except Exception as e:
        protocol.fail(f'NASA POWER hourly request failed: {e}')

    df, solpos = sun_position.prepare_hourly(hourly, lat, lon, float(np.nanmean(elevation)))
    if df.empty:
        protocol.fail('NASA POWER returned no usable hourly record for this point')
    n_years = max(len(set(df.index.year)), 1)

    beam_share = sun_record.beam_fraction(df)

    # Whether the terrain encloses the site enough for the diffuse loss to be
    # a figure rather than noise, read off the horizon already traced.
    enclosure = poa_mod.horizon_enclosure(horizon)
    svf_loss = (
        poa_mod.diffuse_loss_fraction(horizon)
        if enclosure['encloses'] else None
    )

    def _poa_for(name):
        """
        Plane-of-array total for a season, attenuated by terrain shading.

        Two losses, on two bases: the horizon blocks beam energy below it,
        scaled by the beam share, and it hides part of the sky dome, removing
        diffuse energy in proportion to the sky view factor. The published
        shading layer stays the unscaled beam fraction.
        """
        m = seasons_mod.season_mask(df.index, name)
        sub, sp = df[m], solpos[m]
        if sub.empty:
            protocol.fail(f'no hourly record inside the {name} window')
        yrs = seasons_mod.season_years(df.index, name)
        tbl = poa_mod.build_poa_lookup(sub, sp, max(yrs, 1e-6))
        raw = poa_mod.interpolate_poa(slope, aspect, tbl)
        hist, edges = sun_position.beam_energy_histogram(sub, sp)
        loss = poa_mod.shading_loss_fraction(horizon, hist, edges)
        attenuated = raw * (1.0 - loss * beam_share)
        if svf_loss is not None:
            attenuated = attenuated * (1.0 - svf_loss * (1.0 - beam_share))
        return attenuated, loss

    protocol.emit_progress(76, 'plane-of-array lookup')
    companion = None
    shading_loss = None
    if season == 'anisotropy':
        # Winter over summer in one layer: the seasonal contrast the annual
        # map averages away, carried per pixel as a ratio.
        protocol.emit_progress(78, 'lookup [winter]')
        winter, _ = _poa_for('winter')
        protocol.emit_progress(85, 'lookup [summer]')
        summer, shading_loss = _poa_for('summer')
        with np.errstate(divide='ignore', invalid='ignore'):
            poa = np.where(summer > 0, winter / summer, np.nan)
        unit = 'winter / summer'
    elif season == 'shading':
        protocol.emit_progress(80, 'horizon shading over the year')
        _, shading_loss = _poa_for('annual')
        poa = shading_loss
        unit = 'fraction of beam blocked'
    elif season in overlays_mod.SEASON_PAIR:
        # The companion season is computed only so both land on one colour
        # domain; their spatial spread differs by about a factor of ten.
        protocol.emit_progress(78, f'lookup [{season}]')
        poa, shading_loss = _poa_for(season)
        other = overlays_mod.SEASON_PAIR[season]
        protocol.emit_progress(85, f'lookup [{other}], shared colour scale')
        companion, _ = _poa_for(other)
        unit = 'kWh/m² per season'
    else:
        protocol.emit_progress(80, f'lookup [{season}]')
        poa, shading_loss = _poa_for(season)
        unit = 'kWh/m² per season' if season != 'annual' else 'kWh/m² per year'
    protocol.emit_progress(92, 'interpolating onto the terrain')

    # Only pixels inside the area carry a result.
    inside = ~geometry_mask(
        [polygon.__geo_interface__], out_shape=poa.shape,
        transform=dem_transform, invert=False
    )
    valid = inside & np.isfinite(poa)
    if not valid.any():
        protocol.fail('the DEM window does not overlap the area')

    scale = overlays_mod.render_scale(season, poa, valid, companion, valid)
    png = work_dir / 'solar_poa.png'
    comp.write_rgba_png(
        overlays_mod.terrain_rgba(
            poa, valid, scale['min'], scale['max'], scale['palette']
        ),
        png,
    )

    tif = work_dir / 'solar_poa.tif'
    prof = dem_profile.copy()
    prof.update(dtype='float32', count=1, compress='lzw', nodata=float('nan'))
    with rasterio.open(tif, 'w', **prof) as dst:
        dst.write(np.where(valid, poa, np.nan).astype('float32'), 1)

    vals = poa[valid]
    lon_min, lon_max, lat_min, lat_max = ref_grid.get_map_extent(
        {'transform': dem_transform, 'crs': dem_crs,
         'height': poa.shape[0], 'width': poa.shape[1]}
    )
    protocol.emit_progress(100, 'done')
    summary = poa_mod.summarise(
        vals, slope, valid,
        shading_loss=shading_loss, svf_loss=svf_loss, enclosure=enclosure,
        scale=scale, season=season, unit=unit, n_years=n_years,
        beam_share=beam_share, cell_km2=dx_m * dy_m / 1e6,
    )
    # Added after summarise, which rebuilds the scale from a fixed set of
    # keys: the palette's stops, so the legend is drawn from the colours that
    # drew the raster.
    summary['scale'] = {**summary['scale'], 'stops': comp.palette_hex(scale['palette'])}
    protocol.reply({
        'solar_terrain': {
            **summary,
            'power_provenance': {'hourly': hourly_provenance},
            'overlay_png': str(png),
            'raster_tif': str(tif),
            'extent': {
                'lon_min': lon_min, 'lat_min': lat_min,
                'lon_max': lon_max, 'lat_max': lat_max,
            },
        }
    })


# The defaults every energy action applies to a parameter the caller omits.
# The interface shows them in place of the word "default", read from here so it
# never carries a second copy of the constants. No network and no raster work:
# it answers in the time the interpreter takes to start and import numpy, which
# is why the shell runs it outside the one-request rule.
def parameter_defaults(req: protocol.Request) -> None:
    from terra_energy_engine.energy import pv as pv_mod, seasons as seasons_mod, wind as wind_mod
    from terra_energy_engine.grid import actions as grid_actions, demand as demand_mod
    from terra_energy_engine.terrain import usable as usable_mod

    lo, hi = wind_mod.ROUGHNESS_BAND_M
    protocol.reply({
        'solar': {
            'climatology_years': SOLAR_CLIMATOLOGY_YEARS,
            'hourly_years': SOLAR_HOURLY_YEARS,
            'surface_azimuth': SOLAR_SURFACE_AZIMUTH,
            'performance_ratio': pv_mod.REFERENCE_PERFORMANCE_RATIO,
        },
        'wind': {
            'record_years': wind_mod.RECORD_YEARS,
            'hub_height_m': wind_mod.HUB_HEIGHT_M,
            'calm_threshold_ms': wind_mod.CALM_THRESHOLD_MS,
            'record_max_floor_ms': wind_mod.RECORD_MAX_FLOOR_MS,
            'roughness_band_m': [lo, hi],
        },
        'terrain': {
            'hourly_years': TERRAIN_HOURLY_YEARS,
            'season': TERRAIN_SEASON,
            # Every name solar_terrain accepts, in the order the interface
            # lists them: the month windows as seasons.py declares them, then
            # the two derived layers.
            'seasons': [*seasons_mod.SEASONS, *TERRAIN_DERIVED_SEASONS],
        },
        'connection': {
            'search_radius_km': grid_actions.SEARCH_RADIUS_KM,
        },
        'demand': {
            'yield_ceiling_kwh_kwp': demand_mod.DEFAULT_CEILING_KWH_KWP,
            'cell_km': demand_mod.CELL_KM,
        },
        'ground': {
            'slope_max_deg': usable_mod.SLOPE_MAX_DEG,
            'hand_min_m': usable_mod.HAND_MIN_M,
        },
    })
