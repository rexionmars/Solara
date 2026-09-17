"""
The grid store: how a failure to reach it is said, how an area becomes the
extent of a layer, and -- where a store is running on this machine -- the shape
of what each action returns.
"""

from __future__ import annotations

import json

import pytest

from terra_energy_engine import protocol, registry
from terra_energy_engine.grid import actions, store


@pytest.mark.parametrize('name', ['grid_coverage', 'grid_plants', 'grid_network', 'grid_congestion'])
def test_the_registry_routes_the_grid_actions(name):
    assert registry.resolve(name) is getattr(actions, name)


@pytest.mark.parametrize('libpq, fragment', [
    ('connection to server failed: FATAL:  database "terra_br" does not exist', 'no database'),
    ('connection to server at "127.0.0.1", port 1 failed: Connection refused', 'No PostgreSQL server answered'),
    ('FATAL:  password authentication failed for user "x"', 'refused these credentials'),
    ('connection to server failed: timeout expired', 'did not answer within'),
    ('something libpq has never said', 'could not be opened: something libpq has never said'),
])
def test_an_unreachable_store_is_said_as_what_to_do(libpq, fragment):
    assert fragment in store._why_unreachable(Exception(libpq), 'postgresql:///terra_br')


def test_a_password_never_reaches_the_screen():
    msg = store._why_unreachable(Exception('Connection refused'), 'postgresql://ana:s3cret@db.local/terra_br')
    assert 's3cret' not in msg
    assert 'ana@db.local' in msg


def square(lon=-40.0, lat=-9.0, side=0.1):
    return {'type': 'Polygon', 'coordinates': [[
        [lon, lat], [lon + side, lat], [lon + side, lat + side], [lon, lat + side], [lon, lat],
    ]]}


def test_an_area_narrows_a_layer_to_its_padded_envelope():
    bbox = actions._padded_bbox({'polygon_geojson': square(), 'pad_degrees': 0.5}, 0.25)
    assert bbox == pytest.approx([-40.5, -9.5, -39.4, -8.4])


def test_a_bbox_given_wins_over_the_area():
    assert actions._padded_bbox({'bbox': [1, 2, 3, 4], 'polygon_geojson': square()}, 0.25) == [1, 2, 3, 4]


def test_a_zero_pad_is_a_pad_of_zero_and_not_the_default():
    bbox = actions._padded_bbox({'polygon_geojson': square(), 'pad_degrees': 0}, 0.25)
    assert bbox == pytest.approx([-40.0, -9.0, -39.9, -8.9])


def test_the_connection_reading_needs_an_area(capsys):
    pytest.importorskip('psycopg')
    with pytest.raises(SystemExit):
        actions._aoi({})
    assert 'polygon_geojson' in capsys.readouterr().err


def test_a_refused_connection_becomes_a_reason_and_not_a_traceback():
    pytest.importorskip('psycopg')
    with pytest.raises(store.StoreUnreachable) as exc:
        store.connect({'br_store_dsn': 'postgresql://127.0.0.1:1/terra_nothing_here'})
    assert isinstance(exc.value, protocol.Unavailable)
    assert '127.0.0.1' in str(exc.value)


# ---- Against a running store, where there is one ------------------------------------


@pytest.fixture(scope='module')
def live():
    pytest.importorskip('psycopg')
    try:
        store.connect().close()
    except protocol.Unavailable as e:
        pytest.skip(f'no grid store on this machine: {e}')


def reply(capsys, key):
    return json.loads(capsys.readouterr().out)[key]


def test_coverage_says_what_the_store_holds(live, capsys):
    actions.grid_coverage({})
    held = reply(capsys, 'grid_coverage')
    assert held['plants']['registered'] >= held['plants']['with_geometry'] >= 0
    assert {'substations', 'lines_in_service'} <= held['network'].keys()


def test_the_network_layer_is_two_collections(live, capsys):
    actions.grid_network({'polygon_geojson': square(), 'pad_degrees': 2.0})
    layer = reply(capsys, 'grid_network')
    assert layer['lines']['type'] == layer['substations']['type'] == 'FeatureCollection'
    assert layer['counts']['substations'] == len(layer['substations']['features'])


def test_the_connection_reading_reports_reach_and_curtailment_apart(live, capsys):
    actions.grid_congestion({'polygon_geojson': square(), 'search_radius_km': 150})
    got = reply(capsys, 'grid_congestion')
    assert got['connection']['searched_km'] == 150
    # Either the curtailment half is there, or the reason it is not.
    assert (got['curtailment_at_connected_plants'] is None) or (got['curtailment_absent'] is None)
