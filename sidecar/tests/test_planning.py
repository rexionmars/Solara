"""Analytical fixtures exercise the actual PyPSA/HiGHS solver, not mock results."""
import copy
import json
from pathlib import Path
import subprocess
import sys

import pytest

from terra_energy_engine.planning import solve, validate


def study():
    return dict(schema_version=1, name='Analytical dispatch', currency='EUR', provenance='Synthetic analytical test', mode='dispatch',
                snapshots=[dict(time='2026-01-01T00:00:00Z', duration_hours=1), dict(time='2026-01-01T01:00:00Z', duration_hours=1)],
                buses=[dict(id='A', v_nom_kv=110)],
                generators=[dict(id='cheap', bus='A', carrier='gas', existing_mw=40, expandable=False, max_mw=100,
                                 annualized_cost_per_mw_year=8760, marginal_cost_per_mwh=20, co2_tonnes_per_mwh=0.5, availability=[1, 1]),
                            dict(id='dear', bus='A', carrier='gas', existing_mw=100, expandable=False, max_mw=100,
                                 annualized_cost_per_mw_year=876000, marginal_cost_per_mwh=100, co2_tonnes_per_mwh=0.5, availability=[1, 1])],
                loads=[dict(id='demand', bus='A', p_mw=[30, 60])], lines=[], storage=[])


def test_merit_order_energy_emissions_and_sunk_costs():
    result = solve(study())
    cheap, dear = result['generators']
    assert cheap['generation_mwh'] == pytest.approx(70)
    assert dear['generation_mwh'] == pytest.approx(20)
    assert result['summary']['objective'] == pytest.approx(3400)
    assert result['summary']['expansion_cost'] == 0
    assert result['summary']['co2_tonnes'] == pytest.approx(45)
    assert result['summary']['demand_mwh'] == pytest.approx(90)
    assert result['summary']['max_nodal_balance_error_mw'] < 1e-6
    assert result['study'] == study()
    assert len(result['study_sha256']) == 64


def test_zero_cost_dispatch_is_a_valid_feasibility_problem():
    s = study()
    for g in s['generators']:
        g['marginal_cost_per_mwh'] = 0
    r = solve(s)
    assert r['summary']['objective'] == 0
    assert r['summary']['generation_mwh'] == pytest.approx(90)
    assert any('economically unique' in w for w in r['warnings'])


def test_expansion_pays_only_added_capacity_and_matches_objective():
    s = study()
    s['mode'] = 'expansion'
    s['generators'][0]['expandable'] = True
    r = solve(s)
    assert r['generators'][0]['optimized_mw'] == pytest.approx(60)
    assert r['generators'][0]['added_mw'] == pytest.approx(20)
    assert r['summary']['expansion_cost'] == pytest.approx(40)
    assert r['summary']['operating_cost'] == pytest.approx(1800)
    assert r['summary']['objective'] == pytest.approx(1840)


def test_line_bottleneck_and_reinforcement():
    s = study()
    s['buses'].append(dict(id='B', v_nom_kv=110))
    s['loads'][0]['bus'] = 'B'
    s['generators'][1]['bus'] = 'B'
    s['generators'][0]['existing_mw'] = 100
    s['lines'] = [dict(id='AB', bus0='A', bus1='B', x_ohm=10, existing_mva=20, expandable=True, max_mva=100, annualized_cost_per_mva_year=8760)]
    r = solve(s)
    assert r['lines'][0]['peak_loading_pct'] == pytest.approx(100)
    assert r['lines'][0]['hours_at_limit'] == pytest.approx(2)
    assert r['generators'][0]['generation_mwh'] == pytest.approx(40)
    s['mode'] = 'expansion'
    r = solve(s)
    assert r['lines'][0]['optimized_mva'] == pytest.approx(60)
    assert r['summary']['objective'] == pytest.approx(1880)


def test_chronological_storage_losses_and_duration_weighting():
    s = study()
    s['snapshots'][0]['duration_hours'] = 2
    s['snapshots'][1]['time'] = '2026-01-01T02:00:00Z'
    s['generators'] = [s['generators'][0]]
    s['generators'][0].update(existing_mw=100, availability=[1, 0])
    s['loads'][0]['p_mw'] = [10, 16]
    s['storage'] = [dict(id='battery', bus='A', existing_mw=30, expandable=False, max_mw=30, annualized_cost_per_mw_year=0,
                         marginal_cost_per_mwh=1, max_hours=2, efficiency_store=0.8, efficiency_dispatch=0.8)]
    r = solve(s)
    assert r['summary']['demand_mwh'] == pytest.approx(36)
    assert r['storage'][0]['charged_mwh'] == pytest.approx(25)
    assert r['storage'][0]['discharged_mwh'] == pytest.approx(16)
    assert r['storage'][0]['losses_mwh'] == pytest.approx(9)
    assert r['summary']['generation_mwh'] == pytest.approx(45)
    assert r['summary']['objective'] == pytest.approx(916)


def test_meshed_network_enforces_kirchhoff_flow_split():
    s = study()
    s['buses'] += [dict(id='B', v_nom_kv=110), dict(id='C', v_nom_kv=110)]
    s['loads'][0]['bus'] = 'B'
    s['generators'][0]['existing_mw'] = 100
    s['generators'][1]['bus'] = 'B'
    s['lines'] = [dict(id=name, bus0=b0, bus1=b1, x_ohm=10, existing_mva=100, expandable=False,
                       max_mva=100, annualized_cost_per_mva_year=0)
                  for name, b0, b1 in [('AB', 'A', 'B'), ('AC', 'A', 'C'), ('CB', 'C', 'B')]]
    r = solve(s)
    for row, demand in zip(r['timeseries'], [30, 60]):
        assert row['flow_by_line']['AB'] == pytest.approx(demand*2/3)
        assert row['flow_by_line']['AC'] == pytest.approx(demand/3)
        assert row['flow_by_line']['CB'] == pytest.approx(demand/3)


def test_storage_expansion_costs_and_energy_capacity():
    s = study()
    s['mode'] = 'expansion'
    s['generators'] = s['generators'][:1]
    s['generators'][0].update(existing_mw=100, availability=[1, 0])
    s['loads'][0]['p_mw'] = [10, 16]
    s['storage'] = [dict(id='battery', bus='A', existing_mw=5, expandable=True, max_mw=40,
                         annualized_cost_per_mw_year=8760, marginal_cost_per_mwh=1, max_hours=1,
                         efficiency_store=1, efficiency_dispatch=1)]
    r = solve(s)
    assert r['storage'][0]['optimized_mw'] == pytest.approx(16)
    assert r['storage'][0]['added_mw'] == pytest.approx(11)
    assert r['storage'][0]['energy_capacity_mwh'] == pytest.approx(16)
    assert r['summary']['objective'] == pytest.approx(558)


@pytest.mark.parametrize('mode', ['dispatch', 'expansion'])
def test_shipped_synthetic_study_solves_and_reports_are_strict_json(mode):
    path = Path(__file__).resolve().parents[2]/'docs/examples/system-planning.json'
    s = json.loads(path.read_text())
    s['mode'] = mode
    r = solve(s)
    assert r['summary']['demand_mwh'] == pytest.approx(1205)
    assert r['summary']['max_nodal_balance_error_mw'] < 1e-6
    json.dumps(r, allow_nan=False)


def test_co2_constraint_changes_dispatch_and_infeasibility_is_explicit():
    s = study()
    s['generators'][1]['co2_tonnes_per_mwh'] = 0
    s['co2_limit_tonnes'] = 10
    r = solve(s)
    assert r['summary']['co2_tonnes'] == pytest.approx(10)
    assert r['generators'][0]['generation_mwh'] == pytest.approx(20)
    s['generators'] = s['generators'][:1]
    with pytest.raises(ValueError, match='infeasible'):
        solve(s)


@pytest.mark.parametrize('mutate,match', [
    (lambda s: s['loads'][0].update(p_mw=[1]), 'exactly 2'),
    (lambda s: s['loads'][0].update(bus='unknown'), 'unknown bus'),
    (lambda s: s['generators'][0].update(availability=[1, 2]), 'finite number'),
    (lambda s: s['generators'][0].update(existing_mw=float('nan')), 'finite number'),
    (lambda s: s.update(unit_commitment=True), 'unsupported fields'),
    (lambda s: s['snapshots'][1].update(time='2026-01-01T03:00:00Z'), 'contiguous'),
    (lambda s: s['snapshots'][0].update(time='2026-01-01T00:00:00'), 'timezone'),
    (lambda s: s['generators'][0].update(expandable=True, annualized_cost_per_mw_year=0), 'positive annualized cost'),
    (lambda s: s['buses'].append(copy.deepcopy(s['buses'][0])), 'duplicate ID'),
])
def test_invalid_studies_rejected_before_solving(mutate, match):
    s = study()
    mutate(s)
    with pytest.raises(ValueError, match=match):
        validate(s)


def test_sidecar_stdout_is_one_json_document():
    root = Path(__file__).resolve().parents[1]
    run = subprocess.run([sys.executable, str(root/'main.py')], input=json.dumps(dict(action='system_planning', study=study())),
                         text=True, capture_output=True, timeout=90)
    assert run.returncode == 0, run.stderr
    report = json.loads(run.stdout)
    assert report['engine']['termination'] == 'optimal'
    assert report['summary']['objective'] == pytest.approx(3400)
