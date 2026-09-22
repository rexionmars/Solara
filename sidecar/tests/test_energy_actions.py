"""
The energy actions' inputs: what they refuse before any request leaves the
machine, and the registry that routes to them.
"""

from __future__ import annotations

import json

import pytest

from terra_energy_engine import registry
from terra_energy_engine.energy import actions


def refused(capsys, call) -> str:
    """Run `call`, which must fail through protocol.fail; return its message."""
    with pytest.raises(SystemExit) as exc:
        call()
    assert exc.value.code == 1
    return json.loads(capsys.readouterr().err.strip().splitlines()[-1])['error']


@pytest.mark.parametrize('req', [
    {},
    {'lon': -48.0},
    {'lon': 'west', 'lat': -15.0},
    {'lon': None, 'lat': -15.0},
])
def test_a_site_must_be_given_as_lon_and_lat(capsys, req):
    assert 'lon and lat' in refused(capsys, lambda: actions.request_site(req))


@pytest.mark.parametrize('lon,lat', [
    (181.0, 0.0), (0.0, -90.5), (float('nan'), 0.0), (float('inf'), 0.0),
])
def test_a_site_off_the_globe_is_refused(capsys, lon, lat):
    msg = refused(capsys, lambda: actions.request_site({'lon': lon, 'lat': lat}))
    assert 'not a longitude and latitude' in msg


def test_a_valid_site_is_returned_as_floats():
    assert actions.request_site({'lon': '-48.5', 'lat': -15}) == (-48.5, -15.0)


@pytest.mark.parametrize('value', [0, 1.5, -0.2, True, '0.8'])
def test_a_performance_ratio_outside_the_unit_interval_is_refused(capsys, value):
    msg = refused(
        capsys, lambda: actions.request_performance_ratio({'performance_ratio': value})
    )
    assert 'performance_ratio' in msg


def test_an_absent_performance_ratio_selects_the_reference():
    assert actions.request_performance_ratio({}) is None
    assert actions.request_performance_ratio({'performance_ratio': 0.83}) == 0.83


def test_a_zero_record_is_refused_before_anything_is_fetched(capsys):
    """
    TERRA's runner sent climatology_years 0 whenever the field was left unset,
    which request_positive refuses. The refusal has to happen before the fetch,
    or a broken request would cost a network round trip first.
    """
    req = {'lon': -48.0, 'lat': -15.0, 'climatology_years': 0}
    msg = refused(capsys, lambda: actions.solar_resource(req))
    assert 'climatology_years' in msg


@pytest.mark.parametrize('name', [
    'solar_resource', 'wind_resource', 'solar_terrain', 'parameter_defaults',
])
def test_the_registry_routes_the_energy_actions(name):
    assert registry.resolve(name) is getattr(actions, name)


def square(lon=-47.9, lat=-15.8, side=0.05):
    return {'type': 'Polygon', 'coordinates': [[
        [lon, lat], [lon + side, lat], [lon + side, lat + side],
        [lon, lat + side], [lon, lat],
    ]]}


def test_a_small_valid_area_is_accepted():
    polygon = actions.request_area({'polygon_geojson': square()}, 1700.0)
    assert polygon.is_valid and polygon.area > 0


@pytest.mark.parametrize('geom, fragment', [
    (None, 'no area'),
    ({'type': 'Point', 'coordinates': [-47.9, -15.8]}, 'single polygon'),
    # A bow tie: the outline crosses itself.
    ({'type': 'Polygon', 'coordinates': [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]]}, 'crosses itself'),
    # Two degrees square is several hundred million elevation cells.
    (square(side=2.0), 'too large'),
])
def test_an_area_that_cannot_be_computed_is_refused_before_any_download(capsys, geom, fragment):
    msg = refused(capsys, lambda: actions.request_area({'polygon_geojson': geom}, 1700.0))
    assert fragment in msg


def test_the_terrain_product_needs_a_directory_for_its_layer(capsys):
    msg = refused(capsys, lambda: actions.solar_terrain({'polygon_geojson': square()}))
    assert 'work_dir' in msg


def test_an_unknown_season_is_refused_before_any_download(capsys, tmp_path):
    req = {'polygon_geojson': square(), 'work_dir': str(tmp_path), 'season': 'monsoon'}
    assert 'unknown season' in refused(capsys, lambda: actions.solar_terrain(req))


def test_the_parameter_defaults_are_the_ones_the_actions_apply(capsys):
    """
    The interface shows these in place of the word "default", so they have to
    be the constants the actions read, not a copy that can drift from them.
    """
    from terra_energy_engine.energy import pv, wind
    from terra_energy_engine.grid import actions as grid_actions, demand

    actions.parameter_defaults({})
    reply = json.loads(capsys.readouterr().out)
    assert reply == {
        'solar': {
            'climatology_years': actions.SOLAR_CLIMATOLOGY_YEARS,
            'hourly_years': actions.SOLAR_HOURLY_YEARS,
            'surface_azimuth': actions.SOLAR_SURFACE_AZIMUTH,
            'performance_ratio': pv.REFERENCE_PERFORMANCE_RATIO,
        },
        'wind': {
            'record_years': wind.RECORD_YEARS,
            'hub_height_m': wind.HUB_HEIGHT_M,
            'calm_threshold_ms': wind.CALM_THRESHOLD_MS,
            'record_max_floor_ms': wind.RECORD_MAX_FLOOR_MS,
            'roughness_band_m': list(wind.ROUGHNESS_BAND_M),
        },
        'terrain': {
            'hourly_years': actions.TERRAIN_HOURLY_YEARS,
            'season': actions.TERRAIN_SEASON,
            'seasons': ['annual', 'winter', 'summer', 'winter_crop', 'anisotropy', 'shading'],
        },
        'connection': {
            'search_radius_km': grid_actions.SEARCH_RADIUS_KM,
        },
        'demand': {
            'yield_ceiling_kwh_kwp': demand.DEFAULT_CEILING_KWH_KWP,
            'cell_km': demand.CELL_KM,
        },
    }


def test_every_reported_season_is_one_the_terrain_product_accepts(capsys):
    """
    A season the interface offers and the action refuses would fail only after
    the user had drawn an area and started the run.
    """
    actions.parameter_defaults({})
    reply = json.loads(capsys.readouterr().out)['terrain']
    for season in reply['seasons']:
        assert actions.request_season({'season': season}) == season
    assert actions.request_season({}) == reply['season']
