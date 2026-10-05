"""
The world's boundaries: what a country's catalogue is read from when no store
and no national service names its ground. Read here from files already in the
cache, so nothing in these tests reaches the network.
"""

from __future__ import annotations

import json

import pytest

from terra_energy_engine import protocol, registry
from terra_energy_engine.weather import wind
from terra_energy_engine.world import boundaries


@pytest.fixture
def cache(tmp_path):
    (tmp_path / 'XYZ-levels.json').write_text(json.dumps([
        {'boundaryType': 'ADM0', 'boundaryCanonical': 'Unknown', 'admUnitCount': '1'},
        {'boundaryType': 'ADM2', 'boundaryCanonical': 'Freguesias', 'admUnitCount': '2'},
        {'boundaryType': 'ADM1', 'boundaryCanonical': 'gbOpen', 'admUnitCount': '1'},
    ]))
    square = {'type': 'Polygon', 'coordinates': [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]}
    (tmp_path / 'XYZ-ADM2.geojson').write_text(json.dumps({'type': 'FeatureCollection', 'features': [
        {'type': 'Feature', 'properties': {'shapeID': 'b', 'shapeName': 'Beta'}, 'geometry': square},
        {'type': 'Feature', 'properties': {'shapeID': 'a', 'shapeName': 'Alpha'}, 'geometry': square},
    ]}))
    return tmp_path


def test_the_registry_routes_the_world():
    assert registry.resolve('world_countries') is boundaries.world_countries
    assert registry.resolve('world_boundaries') is boundaries.world_boundaries


def test_levels_come_in_order_and_keep_only_a_name_the_source_gave(cache):
    assert boundaries.levels(cache, 'XYZ') == [
        {'level': 0, 'name': '', 'count': 1},
        {'level': 1, 'name': '', 'count': 1},
        {'level': 2, 'name': 'Freguesias', 'count': 2},
    ]


def test_a_levels_boundaries_are_listed_by_name_without_their_shapes(cache):
    assert boundaries.places(cache, 'XYZ', 2) == [{'id': 'a', 'name': 'Alpha'}, {'id': 'b', 'name': 'Beta'}]


def test_one_boundary_comes_back_with_its_outline(cache):
    got = boundaries.shape(cache, 'XYZ', 2, 'b')
    assert got['name'] == 'Beta' and got['geometry']['type'] == 'Polygon'


def test_a_boundary_the_level_does_not_hold_is_said_as_that(cache):
    with pytest.raises(protocol.Unavailable, match='no boundary'):
        boundaries.shape(cache, 'XYZ', 2, 'nope')


def test_the_wind_is_asked_over_the_region_given():
    import datetime as dt

    url = wind.subset_url(10, dt.datetime(2026, 1, 1, tzinfo=dt.UTC), region=(-30.0, 25.0, 55.0, 90.0))
    assert 'west=-30.0' in url and 'east=55.0' in url and 'south=25.0' in url and 'north=90.0' in url
