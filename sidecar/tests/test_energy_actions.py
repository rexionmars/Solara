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


@pytest.mark.parametrize('name', ['solar_resource', 'wind_resource'])
def test_the_registry_routes_the_energy_actions(name):
    assert registry.resolve(name) is getattr(actions, name)
