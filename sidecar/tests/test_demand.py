"""
The demand reading: what it refuses, how it names the register it read, and --
where a store with the BDGD loaded is running on this machine -- the shape of
what it returns.
"""

from __future__ import annotations

import json

import pytest

from terra_energy_engine import protocol, registry
from terra_energy_engine.grid import actions, demand


def test_the_registry_routes_the_demand_action():
    assert registry.resolve('demand_area') is actions.demand_area


def test_the_reading_needs_an_area_before_it_opens_the_store(capsys):
    with pytest.raises(SystemExit):
        actions.demand_area({'action': 'demand_area'})
    said = capsys.readouterr().err
    assert 'polygon_geojson' in said
    # Nothing was opened to find that out.
    assert 'opening the grid store' not in said


def test_an_empty_schema_is_said_as_what_to_load():
    with pytest.raises(protocol.Unavailable) as e:
        demand._chosen([], None, None)
    assert 'bdgd_para_postgis' in str(e.value)


def test_two_distributors_without_a_name_is_refused_rather_than_guessed():
    held = [{'distribuidora': 'A', 'ano': 2024, 'unidades': 1, 'sem_ponto': 0},
            {'distribuidora': 'B', 'ano': 2024, 'unidades': 1, 'sem_ponto': 0}]
    with pytest.raises(protocol.Unavailable) as e:
        demand._chosen(held, None, None)
    assert 'A, B' in str(e.value)


def test_one_distributor_needs_no_choice_and_the_latest_year_wins():
    held = [{'distribuidora': 'A', 'ano': 2023, 'unidades': 1, 'sem_ponto': 0},
            {'distribuidora': 'A', 'ano': 2024, 'unidades': 1, 'sem_ponto': 0}]
    assert demand._chosen(held, None, None) == ('A', 2024)


def test_a_year_that_is_not_held_says_what_is():
    held = [{'distribuidora': 'A', 'ano': 2024, 'unidades': 1, 'sem_ponto': 0}]
    with pytest.raises(protocol.Unavailable) as e:
        demand._chosen(held, 'A', 2019)
    assert 'A 2024' in str(e.value)


def test_installed_power_is_read_as_watts_above_the_split():
    # The register mixes kW and W between rows; the expression the queries use
    # is the only place that split is applied.
    assert f'{demand.POWER_SPLIT_KW}' in demand.NORMALISED_KWP
    assert '/ 1000.0' in demand.NORMALISED_KWP


def test_the_monthly_sum_covers_peak_and_off_peak_where_a_register_splits_them():
    one = demand._sum(['ene'])
    two = demand._sum(['ene_p', 'ene_f'])
    assert one.count('coalesce') == 12
    assert two.count('coalesce') == 24


# --- with a store on this machine -------------------------------------------


def natal():
    return {'type': 'Polygon', 'coordinates': [[
        [-35.35, -5.90], [-35.10, -5.90], [-35.10, -5.70], [-35.35, -5.70], [-35.35, -5.90],
    ]]}


@pytest.fixture
def loaded():
    """A store with a BDGD register in it, or the test is skipped."""
    from terra_energy_engine.grid import store
    try:
        conn = store.connect({})
    except Exception as e:
        pytest.skip(f'no store on this machine: {e}')
    try:
        demand._require_schema(conn)
    except protocol.Unavailable as e:
        conn.close()
        pytest.skip(str(e))
    if not demand.holdings(conn):
        conn.close()
        pytest.skip('the bdgd schema holds no distributor')
    yield conn
    conn.close()


def test_the_reading_counts_units_and_says_which_register_it_read(loaded):
    held = demand.holdings(loaded)
    req = {'distribuidora': held[0]['distribuidora'], 'ano': held[0]['ano']}
    out = demand.demand_context(loaded, natal(), req)
    assert out['register']['distribuidora'] == held[0]['distribuidora']
    assert out['totais']['energia_consumida_ano_mwh'] >= 0
    # The reply carries what it assumed, not only what it counted.
    for k in ('energia_da_geracao', 'potencia_instalada', 'posicao'):
        assert out['assumptions'][k]
    assert json.dumps(out)  # the shell receives this as JSON


def test_generation_reports_what_cannot_be_true_beside_what_can(loaded):
    held = demand.holdings(loaded)
    req = {'distribuidora': held[0]['distribuidora'], 'ano': held[0]['ano'],
           'specific_yield_ceiling_kwh_kwp': 1610.1}
    out = demand.demand_context(loaded, natal(), req)
    for level in out['geracao'].values():
        if not level:
            continue
        assert level['potencia_instalada_plausivel_kw'] <= level['potencia_instalada_kw']
        assert level['acima_do_teto']['teto_kwh_kwp_ano'] == pytest.approx(1610.1)


def test_the_area_itself_settles_which_distributor_when_only_one_reaches_it():
    held = [{'distribuidora': 'A', 'ano': 2024, 'unidades': 1, 'sem_ponto': 0},
            {'distribuidora': 'B', 'ano': 2024, 'unidades': 1, 'sem_ponto': 0}]
    # Concession areas do not overlap, so an area inside one of them needs no
    # name: only where two reach it is the request asked to choose.
    assert demand._chosen(held, None, None, overlapping=[('B', 2024)]) == ('B', 2024)
    with pytest.raises(protocol.Unavailable):
        demand._chosen(held, None, None, overlapping=[('A', 2024), ('B', 2024)])


def test_the_generator_sample_is_bounded_and_the_same_every_time(loaded):
    """
    The cloud the reading draws must be the same cloud on the second run.

    The sample is ordered by a hash of the identifier rather than at random
    precisely so a reader who presses the button again does not get a
    different picture of the same register -- and so the count of rows above
    the ceiling never disagrees with where the points sit.
    """
    held = demand.holdings(loaded)
    req = {'distribuidora': held[0]['distribuidora'], 'ano': held[0]['ano'],
           'specific_yield_ceiling_kwh_kwp': 1610.0}
    first = demand.demand_context(loaded, natal(), req)
    second = demand.demand_context(loaded, natal(), req)
    drew = False
    for level, other in zip(first['geracao'].values(), second['geracao'].values()):
        if not level:
            continue
        rows = level['amostra']
        assert len(rows) <= demand.SAMPLE_ROWS
        assert len(rows) <= level['unidades']
        # Never negative. Not never zero: the register carries generators
        # declaring a fraction of a watt beside real megawatt-hours, and the
        # reading passes them on rather than tidying them away -- the document
        # sets them aside on the plot and says how many there were.
        assert all(kw >= 0 and mwh >= 0 for kw, mwh in rows)
        assert rows == other['amostra']
        drew = drew or bool(rows)
    if not drew:
        pytest.skip('no generator stands inside this area')


def test_an_area_the_register_does_not_reach_is_refused(loaded):
    """
    A ground outside the concession is not answered with the nothing the
    register holds there. The area below is in Acre; every register loaded on
    this machine is in the Northeast.
    """
    held = demand.holdings(loaded)
    acre = {'type': 'Polygon', 'coordinates': [[
        [-70.0, -9.5], [-69.5, -9.5], [-69.5, -9.0], [-70.0, -9.0], [-70.0, -9.5],
    ]]}
    req = {'distribuidora': held[0]['distribuidora'], 'ano': held[0]['ano']}
    with pytest.raises(protocol.Unavailable) as e:
        demand.demand_context(loaded, acre, req)
    assert 'not the distributor of this area' in str(e.value)


def test_the_reading_says_how_much_of_the_area_its_register_covers(loaded):
    held = demand.holdings(loaded)
    req = {'distribuidora': held[0]['distribuidora'], 'ano': held[0]['ano']}
    out = demand.demand_context(loaded, natal(), req)
    reach = out['cobertura']
    if reach is None:
        pytest.skip('this load carries no tariff sets')
    assert reach['dentro_km2'] <= reach['area_km2']
    assert 0 < reach['cobertura_pct'] <= 100


def test_the_registry_routes_the_concessions_layer():
    assert registry.resolve('grid_concessions') is actions.grid_concessions


def test_a_store_without_the_tariff_sets_says_so_rather_than_drawing_nothing(monkeypatch):
    # A load that did not bring bdgd.conj has no reach to draw. The layer has
    # to say WHICH register it cannot draw, or the map reads as "you are
    # outside every concession" -- the opposite of the truth.
    held = [{'distribuidora': 'A', 'ano': 2024, 'unidades': 7, 'sem_ponto': 0}]
    monkeypatch.setattr(demand, 'holdings', lambda conn: held)
    monkeypatch.setattr(demand, 'table_exists', lambda conn, table: False)
    out = demand.concessions(object())
    assert out['concessoes'] == []
    assert out['holdings'] == held
    assert 'bdgd.conj' in out['nota']


def test_the_concession_layer_draws_every_holding_the_store_has(loaded):
    out = demand.concessions(loaded)
    held = demand.holdings(loaded)
    assert len(out['concessoes']) == len(held)
    # It is the reach of the LOAD, not a legal concession, and the note is
    # where a reader is told the difference.
    assert 'legal concession' in out['nota']
    for c in out['concessoes']:
        assert c['distribuidora'] and c['ano']
        # A holding whose sets are missing is reported without a reach rather
        # than dropped, so the caller can name the register it cannot draw.
        if c['geometry'] is None:
            continue
        assert c['geometry']['type'] in ('Polygon', 'MultiPolygon')
        assert c['area_km2'] > 0
    assert json.dumps(out)  # the shell receives this as JSON
