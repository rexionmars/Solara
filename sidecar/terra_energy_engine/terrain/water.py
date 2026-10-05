"""
Permanent water, as a mask on the grid a product already works on.

The elevation model does not say what is water. It carries the sea and the
larger lakes as level surfaces with an elevation like any other cell, so a
product that reads only the model counts them as ground -- and usable ground
then reports a coast as land that floods. This module reads what is water from
a land-cover map and hands it back on the caller's grid.

THE SOURCE IS ESA WORLDCOVER, AND ONLY ITS WATER CLASS. WorldCover is global
at 10 m and is licensed CC BY 4.0, which a tool that may be used commercially
can take; it is served from the Planetary Computer catalogue the elevation
model already comes from, so it needs no key and no new service. Checked
against the catalogue on 2026-10-04: collection `esa-worldcover`, licence
CC-BY-4.0, two maps (2020 as v100, 2021 as v200), class 80 "Permanent water
bodies". The 2021 map is the one read; it is the later and the better
validated of the two.

The other ten classes are in the same raster and are deliberately not read
here. Land cover as a rule of its own is a different decision, with thresholds
a reader has to type, and it does not arrive by accident through a module
called water.

WHAT THE CLASS IS NOT. It is water that was there through 2021 as two
satellites saw it: seasonal water, a river narrower than a few cells, a
reservoir filled since and a wetland (which is a class of its own) are not in
it. PERMANENT_WATER_NOTE says so beside the figure.

A CELL IS WATER WHEN MOST OF IT IS. The map is at 10 m and the elevation model
at 30, so nine of its cells fall in one of the model's; the share of them that
is water is averaged onto the model's grid and a cell is water from a half up.
Taking the nearest cell instead would decide a shoreline by which of nine
cells happened to sit under the centre.
"""

from __future__ import annotations

import numpy as np

from terra_energy_engine import stac

COLLECTION = 'esa-worldcover'
YEAR = 2021
PERMANENT_WATER = 80
# What the map writes where it holds no classification.
UNCLASSIFIED = 0
# The share of a cell that has to be water for the cell to be water.
WATER_SHARE = 0.5

SOURCE = f'ESA WorldCover {YEAR}, 10 m'
# CC BY 4.0 asks for this, and the interface prints it where the figure is read.
ATTRIBUTION = (
    f'© ESA WorldCover project {YEAR} / Contains modified Copernicus Sentinel '
    f'data ({YEAR}) processed by ESA WorldCover consortium'
)

PERMANENT_WATER_NOTE = (
    f'Water is the permanent water class of ESA WorldCover {YEAR}, at 10 m. '
    'Seasonal water, rivers narrower than a few cells, wetlands and anything '
    'that changed since are not in it, and stay under the two rules.'
)
NO_MAP_NOTE = (
    f'ESA WorldCover {YEAR} holds no map over this area, so water was not '
    'told apart from land: the sea and the larger lakes are counted as ground '
    'and fall under the flood rule.'
)


def _items(bounds):
    """The map's tiles over `bounds`, of the one year this module reads."""
    from shapely.geometry import box

    found = stac.search(
        COLLECTION,
        intersects=box(*bounds),
        datetime=f'{YEAR}-01-01/{YEAR}-12-31',
    )
    # The collection holds two maps and the service answers a year's query
    # with whatever overlaps it, so the year is checked on the item as well.
    return [
        item for item in found
        if str(getattr(item, 'properties', {}).get('start_datetime', YEAR)).startswith(str(YEAR))
    ]


def mask(transform, shape, crs, progress=None):
    """
    Permanent water on the grid given, and how much of that grid the map saw.

    Returns (water, covered): two boolean arrays of `shape`. `water` marks the
    cells that are mostly permanent water. `covered` marks the cells the map
    classifies at all; where it does not, nothing is known and the cell is not
    water. Both are all False when the catalogue holds no tile here, which is
    an answer the caller reports and not an error.

    Raises `stac.Unavailable` when the catalogue could not be asked. That is
    not turned into "no water": a run that lost its mask to a timeout would
    report the coast as flooded land again, with nothing on screen to say so.
    """
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.merge import merge as rio_merge
    from rasterio.transform import array_bounds
    from rasterio.warp import reproject

    height, width = shape
    bounds = array_bounds(height, width, transform)
    items = _items(bounds)
    nothing = np.zeros(shape, dtype=bool)
    if not items:
        return nothing, nothing.copy()

    opened = []
    try:
        for n, item in enumerate(items, start=1):
            if progress:
                progress(f'water: reading tile {n} of {len(items)}')
            opened.append(rasterio.open(item.assets['map'].href))
        classes, src_transform = rio_merge(opened, bounds=bounds, nodata=UNCLASSIFIED)
        src_crs = opened[0].crs
    finally:
        for d in opened:
            d.close()
    classes = classes[0]
    if classes.size == 0:
        return nothing, nothing.copy()

    def onto_grid(share):
        out = np.zeros(shape, dtype=np.float32)
        reproject(
            source=share.astype(np.float32),
            destination=out,
            src_transform=src_transform, src_crs=src_crs,
            dst_transform=transform, dst_crs=crs,
            resampling=Resampling.average,
        )
        return out

    water = onto_grid(classes == PERMANENT_WATER) >= WATER_SHARE
    covered = onto_grid(classes != UNCLASSIFIED) >= WATER_SHARE
    return water & covered, covered
