"""
Usable ground on terrain whose answer is known on paper, and what the action
refuses before any elevation is fetched.
"""

from __future__ import annotations

import json

import numpy as np
import pytest

from terra_energy_engine import registry
from terra_energy_engine.terrain import actions, hand, slope as slope_mod, usable


def refused(capsys, call) -> str:
    with pytest.raises(SystemExit) as exc:
        call()
    assert exc.value.code == 1
    return json.loads(capsys.readouterr().err.strip().splitlines()[-1])['error']


def test_the_registry_routes_the_usable_ground_action():
    assert registry.resolve('usable_ground') is actions.usable_ground


def test_a_rule_excludes_what_is_beyond_it_and_not_what_meets_it():
    slope = np.array([4.0, 5.0, 6.0, 6.0])
    height = np.array([9.0, 5.0, 5.0, 4.0])
    got = usable.classify(slope, height, slope_max_deg=5.0, hand_min_m=5.0)
    assert got.tolist() == [usable.USABLE, usable.USABLE, usable.STEEP, usable.BOTH]


def test_the_classes_are_the_two_rules_as_bits():
    assert usable.BOTH == usable.STEEP | usable.FLOOD


def test_the_shares_are_of_the_measured_ground_and_sum_to_it():
    slope = np.array([[1.0, 9.0], [1.0, 9.0], [1.0, 1.0]])
    height = np.array([[9.0, 9.0], [1.0, 1.0], [9.0, 9.0]])
    measured = np.array([[True, True], [True, True], [False, False]])
    s = usable.summarise(slope, height, measured, cell_km2=0.5, slope_max_deg=5.0, hand_min_m=5.0)

    assert s['pixels'] == 4 and s['area_km2'] == 2.0
    assert {c['key']: c['pct'] for c in s['classes']} == {
        'usable': 25.0, 'slope': 25.0, 'flood': 25.0, 'slope_and_flood': 25.0, 'water': 0.0,
    }
    # With no water the two denominators are one.
    assert s['land_km2'] == s['area_km2'] and s['usable_of_land_pct'] == s['usable_pct']
    assert sum(c['area_km2'] for c in s['classes']) == s['area_km2']
    assert s['usable_km2'] == 0.5 and s['usable_pct'] == 25.0
    # Each rule alone counts the cells both rules exclude.
    assert s['excluded_by_slope_pct'] == 50.0 and s['excluded_by_flood_pct'] == 50.0


def test_water_is_a_reason_of_its_own_and_no_rule_is_applied_to_it():
    # Level and at its own drainage, as the model carries the sea: both rules would take it.
    slope = np.array([0.0, 0.0, 9.0])
    height = np.array([0.0, 9.0, 0.0])
    water = np.array([True, False, True])
    got = usable.classify(slope, height, 5.0, 5.0, water)
    assert got.tolist() == [usable.WATER, usable.USABLE, usable.WATER]


def test_the_usable_share_is_said_of_the_area_and_of_its_land():
    """A bay: half sea, and half of the land too low. A quarter of the area, half of the land."""
    slope = np.zeros((2, 4))
    height = np.array([[9.0, 9.0, 0.0, 0.0], [1.0, 1.0, 0.0, 0.0]])
    water = np.array([[False, False, True, True], [False, False, True, True]])
    s = usable.summarise(slope, height, np.ones((2, 4), bool), 1.0, 5.0, 5.0, water)

    assert (s['area_km2'], s['land_km2'], s['water_km2']) == (8.0, 4.0, 4.0)
    assert s['usable_pct'] == 25.0 and s['usable_of_land_pct'] == 50.0
    rows = {c['key']: c for c in s['classes']}
    assert rows['water']['pct'] == 50.0 and rows['water']['pct_of_land'] is None
    assert rows['flood']['pct'] == 25.0 and rows['flood']['pct_of_land'] == 50.0
    # The sea is at height zero and is not counted under the flood rule.
    assert s['excluded_by_flood_pct'] == 50.0
    assert sum(c['pct'] for c in s['classes']) == 100.0


def test_an_area_that_is_all_water_has_no_share_of_land():
    s = usable.summarise(np.zeros((2, 2)), np.zeros((2, 2)), np.ones((2, 2), bool), 1.0, water=np.ones((2, 2), bool))
    assert s['land_km2'] == 0.0 and s['usable_pct'] == 0.0
    assert s['usable_of_land_pct'] is None and s['excluded_by_flood_pct'] is None


def test_the_curves_pass_through_the_rule_that_was_typed():
    rng = np.random.default_rng(7)
    slope = rng.uniform(0, 20, (30, 30))
    height = rng.uniform(0, 20, (30, 30))
    s = usable.summarise(slope, height, np.ones((30, 30), bool), 0.001, 7.5, 3.5)

    at = lambda rows, v: next(r['usable_pct'] for r in rows if r['value'] == v)
    assert at(s['sensitivity']['slope'], 7.5) == s['usable_of_land_pct']
    assert at(s['sensitivity']['hand'], 3.5) == s['usable_of_land_pct']
    # A looser slope rule never leaves less ground; a stricter flood rule never leaves more.
    by_slope = [r['usable_pct'] for r in s['sensitivity']['slope']]
    by_hand = [r['usable_pct'] for r in s['sensitivity']['hand']]
    assert by_slope == sorted(by_slope) and by_hand == sorted(by_hand, reverse=True)


def test_ground_with_no_elevation_is_not_judged():
    with pytest.raises(ValueError):
        usable.summarise(np.zeros((2, 2)), np.zeros((2, 2)), np.zeros((2, 2), bool), 1.0)


def test_a_gap_is_filled_no_higher_than_the_land_or_the_sea():
    z = np.array([[12.0, np.nan], [3.0, 8.0]])
    assert usable.fill_gaps(z)[0, 1] == 0.0
    below = np.array([[-20.0, np.nan], [-5.0, 8.0]])
    assert usable.fill_gaps(below)[0, 1] == -20.0
    with pytest.raises(ValueError):
        usable.fill_gaps(np.full((2, 2), np.nan))


def test_a_valley_floor_is_flood_and_its_walls_are_slope():
    """
    A V-shaped valley descending south: a level floor three cells wide that is
    the drainage, between two walls of 20 percent.

    On paper: the floor sits on its own drainage, so its HAND is about zero and
    the flood rule takes it; the walls rise 6 m per 30 m cell, which is 11.3
    degrees, so the slope rule takes them; and a wall cell is more than 5 m
    above the floor from the first cell out, so only the cells at the foot of
    a wall break both rules.
    """
    H, W = 60, 41
    across = np.clip(np.abs(np.arange(W) - W // 2) - 1, 0, None) * 6.0
    along = np.arange(H, 0, -1)[:, None] * 0.05
    z = across[None, :] + along

    chain = hand.compute(z, 30.0, 30.0, drainage_km2=0.02)
    slope, _ = slope_mod.horn_slope_aspect(z, 30.0, 30.0)
    classes = usable.classify(slope, chain['hand'], slope_max_deg=5.0, hand_min_m=5.0)

    mid = slice(10, 50)
    assert (classes[mid, W // 2] == usable.FLOOD).all()
    assert (classes[mid, 5] == usable.STEEP).all() and (classes[mid, W - 6] == usable.STEEP).all()
    assert not (classes[mid] == usable.USABLE).any()


def test_the_picture_is_transparent_where_nothing_was_measured():
    classes = np.array([[usable.USABLE, usable.FLOOD]], dtype=np.uint8)
    measured = np.array([[True, False]])
    got = usable.rgba(classes, measured)
    assert got[0, 0].tolist() == [0x00, 0x9E, 0x73, 255]
    assert got[0, 1, 3] == 0


@pytest.mark.parametrize('req,word', [
    ({'slope_max_deg': 0}, 'slope_max_deg'),
    ({'slope_max_deg': 95}, 'at most 90'),
    ({'hand_min_m': -1}, 'hand_min_m'),
])
def test_a_rule_that_could_not_be_applied_is_refused(capsys, req, word):
    assert word in refused(capsys, lambda: actions.request_rules(req))


def test_an_absent_rule_selects_the_default_and_a_zero_flood_rule_is_kept():
    assert actions.request_rules({}) == (usable.SLOPE_MAX_DEG, usable.HAND_MIN_M)
    assert actions.request_rules({'hand_min_m': 0}) == (usable.SLOPE_MAX_DEG, 0)


def test_the_action_refuses_a_request_with_no_work_dir(capsys):
    assert 'work_dir' in refused(capsys, lambda: actions.usable_ground({}))


# ------------------------------------------------------------------ the water mask


def write_cover(path, x0, y0, classes, res):
    """A land-cover tile holding `classes`, as the map is served: uint8, zero where unclassified."""
    import rasterio
    from rasterio.transform import from_origin

    classes = np.asarray(classes, dtype='uint8')
    with rasterio.open(
        path, 'w', driver='GTiff', height=classes.shape[0], width=classes.shape[1], count=1,
        dtype='uint8', crs='EPSG:4326', transform=from_origin(x0, y0, res, res), nodata=0,
    ) as dst:
        dst.write(classes, 1)
    return str(path)


class CoverItem:
    def __init__(self, href, year=2021):
        self.assets = {'map': type('Asset', (), {'href': href})()}
        self.properties = {'start_datetime': f'{year}-01-01T00:00:00Z'}


def test_a_cell_is_water_when_most_of_it_is(tmp_path, monkeypatch):
    """
    Nine cells of the map to one of the grid, as 10 m is to 30. The left grid
    cell is all water, the middle one has five of nine, the right one four.
    """
    from rasterio.transform import from_origin

    from terra_energy_engine import stac
    from terra_energy_engine.terrain import water

    W, L = water.PERMANENT_WATER, 30
    fine = np.array([
        [W, W, W,  W, W, L,  W, W, L],
        [W, W, W,  W, W, L,  W, L, L],
        [W, W, W,  W, L, L,  W, L, L],
    ])
    href = write_cover(tmp_path / 'cover.tif', 10.0, 20.0, fine, 0.001)
    monkeypatch.setattr(stac, 'search', lambda *a, **k: [CoverItem(href)])

    got, covered = water.mask(from_origin(10.0, 20.0, 0.003, 0.003), (1, 3), 'EPSG:4326')
    assert got.tolist() == [[True, True, False]]
    assert covered.all()


def test_only_the_year_this_module_names_is_read(tmp_path, monkeypatch):
    from rasterio.transform import from_origin

    from terra_energy_engine import stac
    from terra_energy_engine.terrain import water

    old = write_cover(tmp_path / 'old.tif', 10.0, 20.0, np.full((3, 3), water.PERMANENT_WATER), 0.001)
    monkeypatch.setattr(stac, 'search', lambda *a, **k: [CoverItem(old, year=2020)])
    got, covered = water.mask(from_origin(10.0, 20.0, 0.003, 0.003), (1, 1), 'EPSG:4326')
    assert not got.any() and not covered.any()


def test_ground_the_map_does_not_classify_is_not_water(tmp_path, monkeypatch):
    from rasterio.transform import from_origin

    from terra_energy_engine import stac
    from terra_energy_engine.terrain import water

    href = write_cover(tmp_path / 'void.tif', 10.0, 20.0, np.zeros((3, 3)), 0.001)
    monkeypatch.setattr(stac, 'search', lambda *a, **k: [CoverItem(href)])
    got, covered = water.mask(from_origin(10.0, 20.0, 0.003, 0.003), (1, 1), 'EPSG:4326')
    assert not got.any() and not covered.any()


def test_a_catalogue_that_cannot_be_asked_is_not_read_as_no_water(monkeypatch):
    from rasterio.transform import from_origin

    from terra_energy_engine import stac
    from terra_energy_engine.terrain import water

    def down(*a, **k):
        raise stac.Unavailable('down')

    monkeypatch.setattr(stac, 'search', down)
    with pytest.raises(stac.Unavailable):
        water.mask(from_origin(10.0, 20.0, 0.003, 0.003), (1, 1), 'EPSG:4326')
