"""
Usable ground: how much of an area a plant could stand on, and what excludes
the rest.

Two rules, both typed by the reader and both read off one elevation model:
the ground is too steep above a slope, and too close to the drainage below a
height above it (HAND, terrain/hand.py). A cell that breaks a rule is excluded
and keeps the reason, so the answer is a map of reasons and not a single share.

WATER IS NOT GROUND, AND IS NOT A RULE EITHER. The elevation model carries the
sea and the lakes as level surfaces at their own drainage, so left to the two
rules they come out as ground that floods: 59 percent of a coastal area was
"flood" before this was told apart. Permanent water is read from a land-cover
map (terrain/water.py) and taken out first, under a reason of its own. The
rules are then applied to the land, and every share is said twice: of the area
that was drawn, and of the land inside it.

WHAT THIS DOES NOT SAY. It is a screening by terrain alone. Land cover as a
rule, protected areas, wetlands, tenure and the distance to a connection are
not read, so "usable" here means "land not excluded by these two rules" and
nothing more. The rules are the reader's: there is no threshold in this file that a
study fixed, only the defaults a run applies when none is typed.

THE FLOOD RULE IS OPTIMISTIC, AND SAYS SO. The elevation model is read over
the area and a buffer around it (terrain/dem.py argues the size), not over the
watershed upstream. A channel that enters from beyond the buffer arrives
without its contributing area, so the cells beside it keep a HAND that is too
high and fewer of them fall under the rule than should. The excluded ground is
a lower bound; HAND_CAVEAT is sent with every result so the figure is never
shown without it.

Nothing here reads a catalogue or writes a file: it takes arrays and returns
arrays and numbers, which is what lets the suite check it on terrain whose
answer is known on paper.
"""

from __future__ import annotations

import numpy as np

# The defaults a run applies to a rule the request omits; parameter_defaults
# reports them to the interface from here.
SLOPE_MAX_DEG = 5.0
HAND_MIN_M = 5.0

# The contributing area at which a cell counts as drainage. hand.compute's own
# default, named here because the result reports it: it is a free parameter of
# every HAND, and the excluded ground moves with it.
DRAINAGE_KM2 = 0.5

# The class of each cell in the published raster. Bit 0 is the slope rule and
# bit 1 the flood rule, so BOTH is their union and a reader of the GeoTIFF can
# test one rule with a mask. Water is a value of its own and never combined:
# no rule is applied to it.
USABLE, STEEP, FLOOD, BOTH = 0, 1, 2, 3
WATER = 4
NO_DATA = 255

# Okabe-Ito, which stays apart under the common colour-vision deficiencies.
# The interface draws its legend from these, so it cannot drift from the raster.
CLASSES = (
    (USABLE, 'usable', '#009e73'),
    (STEEP, 'slope', '#e69f00'),
    (FLOOD, 'flood', '#0072b2'),
    (BOTH, 'slope_and_flood', '#cc79a7'),
    # The palette's sky blue: beside the flood rule's blue in meaning, and
    # apart from it in lightness, which is what survives a grey print.
    (WATER, 'water', '#56b4e9'),
)

HAND_CAVEAT = (
    'The flood rule is a lower bound. The elevation model is read over the '
    'area and a buffer of {buffer_km:.1f} km, not over the watershed upstream, '
    'so a channel entering from beyond the buffer arrives without its '
    'contributing area and the ground beside it reads higher above the '
    'drainage than it is.'
)

# The thresholds the two curves are drawn over: what share would be usable had
# the reader typed another rule, with the other rule held where it was typed.
SLOPE_STEPS_DEG = (1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30)
HAND_STEPS_M = (0, 1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30)


def fill_gaps(z: np.ndarray) -> np.ndarray:
    """
    The elevation with its gaps set to the lowest level in the window.

    Copernicus publishes no tile over open sea, so a coastal window arrives
    with NaN where the water is, and the depression fill cannot order a NaN.
    The gap is set to sea level, or to the lowest land in the window when that
    is below it, so the water is where the land drains to and never above it.
    Those cells are reported as having no elevation; this is only so the
    drainage of the cells beside them has somewhere to go.
    """
    out = np.asarray(z, dtype=np.float64).copy()
    gap = ~np.isfinite(out)
    if gap.all():
        raise ValueError('the elevation model holds no valid cell')
    out[gap] = min(0.0, float(out[~gap].min()))
    return out


def classify(slope_deg, hand_m, slope_max_deg: float, hand_min_m: float, water=None) -> np.ndarray:
    """
    The class of every cell: usable, the rule or rules that exclude it, or water.

    A slope equal to the maximum is usable, and so is a height equal to the
    minimum: a rule excludes what is beyond it, not what meets it. A cell that
    is water is water whatever the rules would have said of it.
    """
    steep = np.asarray(slope_deg) > slope_max_deg
    low = np.asarray(hand_m) < hand_min_m
    classes = (steep.astype(np.uint8) * STEEP) | (low.astype(np.uint8) * FLOOD)
    if water is not None:
        classes = np.where(np.asarray(water, dtype=bool), np.uint8(WATER), classes)
    return classes


def summarise(
    slope_deg,
    hand_m,
    measured,
    cell_km2: float,
    slope_max_deg: float = SLOPE_MAX_DEG,
    hand_min_m: float = HAND_MIN_M,
    water=None,
) -> dict:
    """
    Areas and shares by class over the cells `measured` marks, and the two
    curves of what another rule would have left.

    TWO DENOMINATORS, BOTH SENT. `pct` is of the measured area: the cells
    inside the area that carry an elevation, water included, which is the
    ground the reader drew. `pct_of_land` is of what is left of it once the
    water is out, which is the ground a plant could be asked about at all. A
    bay that is half sea is 20 percent usable by the first and 40 by the
    second, and neither is wrong; showing one would let the reader assume the
    other.

    The rules are applied to the land alone, so the share each takes, the
    terrain figures and the curves are all of the land. Ground with no
    elevation is reported beside them, in km2, and is in no share -- it was
    not judged, so it is neither usable nor excluded.
    """
    measured = np.asarray(measured, dtype=bool)
    n = int(measured.sum())
    if n == 0:
        raise ValueError('no cell of the area carries an elevation')
    wet = np.zeros(n, dtype=bool) if water is None else np.asarray(water, dtype=bool)[measured]
    land = ~wet
    n_land = int(land.sum())
    slope = np.asarray(slope_deg)[measured][land]
    height = np.asarray(hand_m)[measured][land]
    classes = classify(slope, height, slope_max_deg, hand_min_m)

    def of_area(count) -> float:
        return round(100.0 * float(count) / n, 2)

    def of_land(count):
        # No land, no share of it: null, not zero, which would read as "none usable".
        return round(100.0 * float(count) / n_land, 2) if n_land else None

    rows = []
    for code, key, colour in CLASSES:
        if code == WATER:
            count, on_land = int(wet.sum()), None
        else:
            count = int((classes == code).sum())
            on_land = of_land(count)
        rows.append({
            'key': key, 'code': code, 'colour': colour,
            'area_km2': round(count * cell_km2, 4),
            'pct': of_area(count), 'pct_of_land': on_land,
        })

    dry = height >= hand_min_m
    gentle = slope <= slope_max_deg
    by_slope = [
        {'value': float(s), 'usable_pct': of_land((dry & (slope <= s)).sum()) or 0.0}
        for s in sorted({*SLOPE_STEPS_DEG, slope_max_deg})
    ]
    by_hand = [
        {'value': float(h), 'usable_pct': of_land((gentle & (height >= h)).sum()) or 0.0}
        for h in sorted({*HAND_STEPS_M, hand_min_m})
    ]

    usable = rows[0]
    return {
        'area_km2': round(n * cell_km2, 4),
        'land_km2': round(n_land * cell_km2, 4),
        'water_km2': round(int(wet.sum()) * cell_km2, 4),
        'usable_km2': usable['area_km2'],
        'usable_pct': usable['pct'],
        'usable_of_land_pct': usable['pct_of_land'],
        'classes': rows,
        # Each rule on its own, of the land; the classes split them three ways.
        'excluded_by_slope_pct': of_land((~gentle).sum()),
        'excluded_by_flood_pct': of_land((~dry).sum()),
        # Of the land, with the other rule held where it was typed.
        'sensitivity': {'slope': by_slope, 'hand': by_hand},
        'slope_mean_deg': round(float(slope.mean()), 2) if n_land else None,
        'slope_max_deg': round(float(slope.max()), 2) if n_land else None,
        'hand_median_m': round(float(np.median(height)), 2) if n_land else None,
        'pixels': n,
    }


def rgba(classes: np.ndarray, measured: np.ndarray) -> np.ndarray:
    """The classes as an (H, W, 4) uint8 picture, transparent where not measured."""
    out = np.zeros((*classes.shape, 4), dtype=np.uint8)
    for code, _, colour in CLASSES:
        here = measured & (classes == code)
        out[here, 0] = int(colour[1:3], 16)
        out[here, 1] = int(colour[3:5], 16)
        out[here, 2] = int(colour[5:7], 16)
        out[here, 3] = 255
    return out
