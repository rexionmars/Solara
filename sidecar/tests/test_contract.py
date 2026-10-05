"""
The store contract: what the loader converts on the way in, how a store's
holdings are reported, and that a reading the contract does not carry is
refused in words rather than attempted.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from terra_energy_engine import protocol, registry
from terra_energy_engine.grid import actions, contract

_spec = importlib.util.spec_from_file_location(
    'contract_load', Path(__file__).resolve().parents[2] / 'contract' / 'load.py')
load = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(load)


def test_the_registry_routes_the_boundaries():
    assert registry.resolve('store_boundaries') is actions.store_boundaries


@pytest.mark.parametrize('raw, want', [
    ('Hydro', 'Hydro'), ('Gas', 'Natural Gas'), ('Coal', 'Hard Coal'),
    ('solar', 'Solar'), ('Natural Gas', 'Natural Gas'), ('wind;solar', 'Wind'),
    ('Wave and Tidal', 'Other'), ('', 'Other'), (None, 'Other'),
])
def test_every_fuel_lands_on_the_contracts_list(raw, want):
    assert load.fueltype(raw) == want
    assert load.fueltype(raw) in contract.FUELTYPES


@pytest.mark.parametrize('raw, want', [
    ('380000', 380.0), ('220000;132000', 220.0), ('132000;380000', 380.0),
    ('15000', 15.0), ('', None), (None, None), ('medium', None),
])
def test_osm_volts_become_the_lines_highest_kilovolts(raw, want):
    assert load.kilovolts(raw) == want


@pytest.mark.parametrize('raw, want', [
    ('500 MW', 500.0), ('1.2 GW', 1200.0), ('800 kW', 0.8), ('3,5 MW', 3.5),
    ('yes', None), ('', None), (None, None),
])
def test_osm_output_becomes_megawatts_or_unknown(raw, want):
    assert load.megawatts(raw) == want


def test_a_contract_stores_holdings_fill_the_coverage_shape():
    report = {'entities': [
        {'entity': 'plant', 'rows': 396, 'located': 390},
        {'entity': 'line', 'rows': 50, 'in_service': 48},
    ]}
    assert contract.counts(report) == {
        'plants': {'registered': 396, 'with_geometry': 390},
        'network': {'substations': 0, 'lines_in_service': 48},
    }


class _Cursor:
    """A cursor whose to_regclass answers from a set of relations that exist."""

    def __init__(self, relations):
        self.relations, self.last = relations, None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        self.last = params[0] if 'to_regclass' in sql else None

    def fetchone(self):
        return (self.last if self.last in self.relations else None,)


class _Conn:
    def __init__(self, *relations):
        self.relations = set(relations)

    def cursor(self):
        return _Cursor(self.relations)


@pytest.mark.parametrize('relations, want', [
    (('br.plant',), 'terra'),
    (('solara.contract',), 'contract'),
    # TERRA's schema carries what the contract does not, so it wins where both are.
    (('br.plant', 'solara.contract'), 'terra'),
    ((), 'none'),
])
def test_the_profile_is_read_off_what_the_database_holds(relations, want):
    assert contract.profile(_Conn(*relations)) == want


def test_a_reading_of_the_brazilian_record_is_refused_over_a_contract_store():
    with pytest.raises(protocol.Unavailable, match='Brazilian record'):
        actions._brazil_only(_Conn('solara.contract'), 'The consumption reading')
    actions._brazil_only(_Conn('br.plant'), 'The consumption reading')


def test_a_database_that_is_not_a_store_is_refused_as_that():
    with pytest.raises(protocol.Unavailable, match='not a Solara store'):
        actions._profile(_Conn())
