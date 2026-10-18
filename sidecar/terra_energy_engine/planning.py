"""Solora's explicit, chronological single-period electricity planning model.

No topology, impedances, demand or costs are inferred from map geometries.
See docs/system-planning.md for units, objective and modelling assumptions.
"""
from __future__ import annotations

from contextlib import redirect_stdout
from datetime import datetime, timezone
import hashlib
import json
import math
import sys

from . import protocol

SCHEMA_VERSION = 1


def number(value, where, minimum=0, maximum=1e12):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not minimum <= value <= maximum:
        raise ValueError(f'{where}: expected a finite number between {minimum:g} and {maximum:g}.')
    return float(value)


def text(value, where):
    if not isinstance(value, str) or not value.strip() or len(value) > 500:
        raise ValueError(f'{where}: enter nonempty text (up to 500 characters).')
    return value


def keys(obj, allowed, where):
    if not isinstance(obj, dict):
        raise ValueError(f'{where}: expected an object.')
    unknown = set(obj) - set(allowed.split())
    if unknown:
        raise ValueError(f'{where}: unsupported fields: {", ".join(sorted(unknown))}.')


def validate(study):
    """Reject silent defaults for engineering quantities and unsupported features."""
    keys(study, 'schema_version name description currency provenance mode snapshots buses generators loads lines storage co2_limit_tonnes', 'Study')
    if type(study.get('schema_version')) is not int or study['schema_version'] != SCHEMA_VERSION:
        raise ValueError('Unsupported study schema_version; expected 1.')
    for key in ('name', 'currency', 'provenance'):
        text(study.get(key), key)
    if study.get('mode') not in ('dispatch', 'expansion'):
        raise ValueError('Choose dispatch or expansion.')
    snapshots = study.get('snapshots')
    if not isinstance(snapshots, list) or not 1 <= len(snapshots) <= 8784:
        raise ValueError('Provide 1–8,784 chronological snapshots.')
    previous, previous_duration = None, None
    for i, row in enumerate(snapshots):
        keys(row, 'time duration_hours', f'snapshots[{i}]')
        duration = number(row.get('duration_hours'), f'snapshots[{i}].duration_hours', 1/60, 24)
        try:
            date = datetime.fromisoformat(row['time'].replace('Z', '+00:00'))
            if date.utcoffset() is None:
                raise ValueError('Timezone required')
            date = date.astimezone(timezone.utc)
        except (ValueError, TypeError, KeyError, AttributeError) as exc:
            raise ValueError(f'snapshots[{i}].time: use an ISO timestamp with timezone.') from exc
        if previous is not None and abs((date-previous).total_seconds()/3600-previous_duration) > 1e-6:
            raise ValueError('Snapshots must be ordered and contiguous; durations must match their timestamps.')
        previous, previous_duration = date, duration
    hours = sum(s['duration_hours'] for s in snapshots)
    if hours > 8784:
        raise ValueError('The single-period study supports up to 8,784 elapsed hours.')
    if study.get('co2_limit_tonnes') is not None:
        number(study['co2_limit_tonnes'], 'co2_limit_tonnes')

    collections = {}
    fields = {
        'buses': 'id v_nom_kv',
        'generators': 'id bus carrier existing_mw expandable max_mw annualized_cost_per_mw_year marginal_cost_per_mwh co2_tonnes_per_mwh availability',
        'loads': 'id bus p_mw',
        'lines': 'id bus0 bus1 x_ohm existing_mva expandable max_mva annualized_cost_per_mva_year',
        'storage': 'id bus existing_mw expandable max_mw annualized_cost_per_mw_year marginal_cost_per_mwh max_hours efficiency_store efficiency_dispatch',
    }
    for kind, allowed in fields.items():
        rows = study.get(kind, [])
        if not isinstance(rows, list) or len(rows) > 1000:
            raise ValueError(f'{kind}: provide a list of up to 1,000 components.')
        seen = set()
        for row in rows:
            keys(row, allowed, kind)
            name = text(row.get('id'), f'{kind}.id')
            if name in seen:
                raise ValueError(f'{kind}: duplicate ID {name}.')
            seen.add(name)
        collections[kind] = rows
    if not all(collections[k] for k in ('buses', 'generators', 'loads')):
        raise ValueError('A study requires buses, generators and loads.')
    # Bound model size as well as rows: hourly × network size determines LP size.
    if len(snapshots) * sum(len(r) for r in collections.values()) > 2_000_000:
        raise ValueError('Study exceeds 2,000,000 component-snapshots; reduce network size or horizon.')
    buses = {b['id']: b for b in collections['buses']}
    for b in buses.values():
        number(b.get('v_nom_kv'), f'{b["id"]}.v_nom_kv', 0.1, 1500)

    def series(values, where, maximum=1e9):
        if not isinstance(values, list) or len(values) != len(snapshots):
            raise ValueError(f'{where}: provide exactly {len(snapshots)} values, one per snapshot.')
        for v in values:
            number(v, where, maximum=maximum)

    for kind in ('generators', 'loads', 'lines', 'storage'):
        for row in collections[kind]:
            name = row['id']
            for key in (('bus0', 'bus1') if kind == 'lines' else ('bus',)):
                if row.get(key) not in buses:
                    raise ValueError(f'{name}.{key}: unknown bus.')
            if kind == 'loads':
                series(row.get('p_mw'), f'{name}.p_mw')
                continue
            if not isinstance(row.get('expandable'), bool):
                raise ValueError(f'{name}.expandable: expected true or false.')
            unit = 'mva' if kind == 'lines' else 'mw'
            existing = number(row.get(f'existing_{unit}'), f'{name}.existing_{unit}')
            maximum = number(row.get(f'max_{unit}'), f'{name}.max_{unit}', existing)
            cost = number(row.get(f'annualized_cost_per_{unit}_year'), f'{name}.annualized_cost_per_{unit}_year')
            if row['expandable'] and (cost <= 0 or maximum <= 0):
                raise ValueError(f'{name}: expansion requires a positive annualized cost and finite positive maximum capacity.')
            if kind == 'lines':
                if row['bus0'] == row['bus1']:
                    raise ValueError(f'{name}: a line must connect different buses.')
                if buses[row['bus0']]['v_nom_kv'] != buses[row['bus1']]['v_nom_kv']:
                    raise ValueError(f'{name}: line terminals must have the same nominal voltage. Transformers are not supported by this model.')
                number(row.get('x_ohm'), f'{name}.x_ohm', 1e-6, 1e6)
                if existing <= 0:
                    raise ValueError(f'{name}: provide a positive existing line rating; new topology is outside this model.')
            else:
                number(row.get('marginal_cost_per_mwh'), f'{name}.marginal_cost_per_mwh')
                if kind == 'generators':
                    text(row.get('carrier'), f'{name}.carrier')
                    number(row.get('co2_tonnes_per_mwh'), f'{name}.co2_tonnes_per_mwh')
                    series(row.get('availability'), f'{name}.availability', 1)
                else:
                    number(row.get('max_hours'), f'{name}.max_hours', 1/60, 10000)
                    for key in ('efficiency_store', 'efficiency_dispatch'):
                        number(row.get(key), f'{name}.{key}', 0.001, 1)
    if sum(sum(l['p_mw']) for l in collections['loads']) <= 0:
        raise ValueError('The demand series must contain positive demand.')
    return collections, hours


def solve(study, progress=lambda *_: None):
    components, hours = validate(study)
    try:
        import pandas as pd
        import pypsa
        import highspy
    except ImportError as exc:
        raise protocol.MissingDependency('System planning requires PyPSA and HiGHS. Install requirements.txt in the sidecar environment.') from exc

    progress(10, 'Building the explicit electricity network')
    n = pypsa.Network()
    # UTC labels are retained in the report; a positional index avoids timezone
    # conversion and PyPSA datetime weighting conventions changing the study.
    n.set_snapshots(pd.Index(range(len(study['snapshots'])), name='snapshot'))
    weights = pd.Series([s['duration_hours'] for s in study['snapshots']], index=n.snapshots)
    for column in n.snapshot_weightings:
        n.snapshot_weightings[column] = weights
    period_years = hours / 8760
    expansion = study['mode'] == 'expansion'
    n.add('Carrier', 'AC')
    for b in components['buses']:
        n.add('Bus', b['id'], v_nom=b['v_nom_kv'], carrier='AC')

    def capacity(row, unit):
        extend = expansion and row['expandable']
        prefix = 's' if unit == 'mva' else 'p'
        return {f'{prefix}_nom': row[f'existing_{unit}'], f'{prefix}_nom_extendable': extend,
                f'{prefix}_nom_min': row[f'existing_{unit}'], f'{prefix}_nom_max': row[f'max_{unit}'],
                'capital_cost': row[f'annualized_cost_per_{unit}_year']*period_years if extend else 0}

    for i, g in enumerate(components['generators']):
        # Separate technical carrier per generator permits distinct emissions
        # factors for units with the same descriptive technology name.
        carrier = f'generator-{i}'
        n.add('Carrier', carrier, co2_emissions=g['co2_tonnes_per_mwh'])
        n.add('Generator', g['id'], bus=g['bus'], carrier=carrier, efficiency=1,
              marginal_cost=g['marginal_cost_per_mwh'], p_max_pu=g['availability'], **capacity(g, 'mw'))
    for load in components['loads']:
        n.add('Load', load['id'], bus=load['bus'], p_set=load['p_mw'])
    for line in components['lines']:
        n.add('Line', line['id'], bus0=line['bus0'], bus1=line['bus1'], x=line['x_ohm'], r=0, **capacity(line, 'mva'))
    for store in components['storage']:
        n.add('StorageUnit', store['id'], bus=store['bus'], carrier='AC', max_hours=store['max_hours'],
              efficiency_store=store['efficiency_store'], efficiency_dispatch=store['efficiency_dispatch'],
              cyclic_state_of_charge=True, marginal_cost=store['marginal_cost_per_mwh'], **capacity(store, 'mw'))
    if study.get('co2_limit_tonnes') is not None:
        n.add('GlobalConstraint', 'CO2', type='primary_energy', carrier_attribute='co2_emissions',
              sense='<=', constant=study['co2_limit_tonnes'])
    zero_cost = not any(g['marginal_cost_per_mwh'] for g in components['generators']) and not any(
        s['marginal_cost_per_mwh'] for s in components['storage']) and not any(
        expansion and row['expandable'] for kind in ('generators', 'storage', 'lines') for row in components[kind])
    extra = None
    if zero_cost:
        # PyPSA refuses to construct a model with no objective terms. Seed its
        # builder, then replace that objective with exactly zero BEFORE solving.
        # Feasible zero-cost studies remain valid without an invented tie-break.
        first = components['generators'][0]['id']
        n.generators.at[first, 'marginal_cost'] = 1
        def zero_objective(network, snapshots):
            network.generators.at[first, 'marginal_cost'] = 0
            network.model.add_objective(network.model['Generator-p'].sum()*0, overwrite=True)
        extra = zero_objective
    progress(30, 'Optimizing dispatch and capacities with HiGHS')
    status, condition = n.optimize(solver_name='highs', solver_options={'time_limit': 180, 'threads': 1, 'output_flag': False},
                                   include_objective_constant=True, extra_functionality=extra)
    if status != 'ok' or condition != 'optimal':
        if condition == 'infeasible':
            raise ValueError('Study is infeasible: demand cannot be met under the generation, availability, line, storage or CO₂ limits. No load shedding is added automatically.')
        raise ValueError(f'Optimization did not reach an optimal solution ({status}: {condition}). No planning result was accepted.')
    progress(90, 'Checking energy balance and assembling the study report')
    clean = lambda v: 0.0 if abs(float(v)) < 1e-7 else float(v)
    integral = lambda values: clean((values * weights).sum())
    generators, lines, stores = [], [], []
    operating_cost, investment_cost, emissions = 0.0, 0.0, 0.0
    for g in components['generators']:
        name = g['id']
        nominal = float(n.generators.at[name, 'p_nom_opt'])
        dispatch = n.generators_t.p[name]
        energy = integral(dispatch)
        available = integral(pd.Series(g['availability'], index=n.snapshots)*nominal)
        added = max(0, nominal-g['existing_mw'])
        cap_cost = added*g['annualized_cost_per_mw_year']*period_years if expansion and g['expandable'] else 0
        op_cost = energy*g['marginal_cost_per_mwh']
        co2 = energy*g['co2_tonnes_per_mwh']
        generators.append(dict(id=name, bus=g['bus'], carrier=g['carrier'], existing_mw=g['existing_mw'],
                               optimized_mw=clean(nominal), added_mw=clean(added), generation_mwh=energy,
                               unused_available_mwh=clean(max(0, available-energy)), capacity_factor=clean(energy/(nominal*hours)) if nominal > 1e-7 else None,
                               operating_cost=clean(op_cost), expansion_cost=clean(cap_cost), co2_tonnes=clean(co2)))
        operating_cost += op_cost; investment_cost += cap_cost; emissions += co2
    for line in components['lines']:
        name = line['id']
        nominal = float(n.lines.at[name, 's_nom_opt'])
        flow = n.lines_t.p0[name]
        utilization = flow.abs()/nominal
        added = max(0, nominal-line['existing_mva'])
        cap_cost = added*line['annualized_cost_per_mva_year']*period_years if expansion and line['expandable'] else 0
        lines.append(dict(id=name, bus0=line['bus0'], bus1=line['bus1'], existing_mva=line['existing_mva'], optimized_mva=clean(nominal),
                          added_mva=clean(added), peak_loading_pct=clean(utilization.max()*100),
                          hours_at_limit=integral((utilization >= 0.9999).astype(float)), expansion_cost=clean(cap_cost)))
        investment_cost += cap_cost
    for store in components['storage']:
        name = store['id']
        nominal = float(n.storage_units.at[name, 'p_nom_opt'])
        charged = integral(n.storage_units_t.p_store[name])
        discharged = integral(n.storage_units_t.p_dispatch[name])
        added = max(0, nominal-store['existing_mw'])
        cap_cost = added*store['annualized_cost_per_mw_year']*period_years if expansion and store['expandable'] else 0
        op_cost = discharged*store['marginal_cost_per_mwh']
        stores.append(dict(id=name, existing_mw=store['existing_mw'], optimized_mw=clean(nominal), added_mw=clean(added),
                           energy_capacity_mwh=clean(nominal*store['max_hours']), charged_mwh=charged, discharged_mwh=discharged,
                           losses_mwh=clean(charged-discharged), expansion_cost=clean(cap_cost), operating_cost=clean(op_cost)))
        operating_cost += op_cost; investment_cost += cap_cost
    timeseries = []
    max_balance = 0.0
    for i, snapshot in enumerate(study['snapshots']):
        gen = {g['id']: clean(n.generators_t.p.at[i, g['id']]) for g in components['generators']}
        demand = {b: sum(l['p_mw'][i] for l in components['loads'] if l['bus'] == b) for b in n.buses.index}
        charge = {s['id']: clean(n.storage_units_t.p_store.at[i, s['id']]) for s in components['storage']}
        discharge = {s['id']: clean(n.storage_units_t.p_dispatch.at[i, s['id']]) for s in components['storage']}
        flows = {l['id']: clean(n.lines_t.p0.at[i, l['id']]) for l in components['lines']}
        for bus in n.buses.index:
            balance = sum(gen[g['id']] for g in components['generators'] if g['bus'] == bus)-demand[bus]
            balance += sum(discharge[s['id']]-charge[s['id']] for s in components['storage'] if s['bus'] == bus)
            balance += sum(flows[l['id']] for l in components['lines'] if l['bus1'] == bus)
            balance -= sum(flows[l['id']] for l in components['lines'] if l['bus0'] == bus)
            max_balance = max(max_balance, abs(balance))
        timeseries.append(dict(**snapshot, demand_mw=clean(sum(demand.values())), generation_mw=clean(sum(gen.values())),
                               charge_mw=clean(sum(charge.values())), discharge_mw=clean(sum(discharge.values())),
                               generation_by_unit=gen, demand_by_bus=demand, flow_by_line=flows,
                               storage_charge_by_unit=charge, storage_discharge_by_unit=discharge,
                               state_of_charge_mwh={s['id']: clean(n.storage_units_t.state_of_charge.at[i, s['id']]) for s in components['storage']}))
    demand_mwh = sum(sum(l['p_mw'][i] for l in components['loads'])*s['duration_hours'] for i, s in enumerate(study['snapshots']))
    if max_balance > max(1e-4, max(t['demand_mw'] for t in timeseries)*1e-6):
        raise ValueError('The solved network failed the nodal energy balance check; results were rejected.')
    cap = study.get('co2_limit_tonnes')
    if cap is not None and emissions > cap + max(1e-5, cap*1e-6):
        raise ValueError('The solved network failed the CO₂ budget check; results were rejected.')
    objective = operating_cost+investment_cost
    if abs(objective-float(n.objective)) > max(0.01, abs(objective)*1e-6):
        raise ValueError('The cost breakdown does not reconcile with the solver objective; results were rejected.')
    fingerprint = hashlib.sha256(json.dumps(study, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
    warnings = ['Lossless linear active-power network; reactive power, voltage magnitudes, AC feasibility, N−1, unit commitment and multiple investment periods are not modelled.',
                'Existing assets are sunk costs. Expansion costs are annualized costs of added capacity, prorated by elapsed hours / 8,760. Operating costs and emissions cover only the modelled horizon.',
                'Storage has a cyclic state of charge over the whole chronological horizon. No free initial energy or automatic load shedding is introduced.']
    if hours < 8760:
        warnings.append('This is a partial-year chronological study. Results are not an annual forecast; capacity choices depend on the supplied horizon.')
    if any(expansion and l['expandable'] for l in components['lines']):
        warnings.append('Line reinforcement changes thermal ratings with fixed reactance and topology; parallel-circuit impedance changes are not modelled.')
    if not components['lines'] and len(components['buses']) > 1:
        warnings.append('Buses have no transmission connections and are optimized as separate islands.')
    if zero_cost:
        warnings.append('All modelled costs are zero. The solution establishes feasibility; dispatch is not economically unique.')
    progress(100, 'System planning complete')
    return dict(schema_version=1, study=study, study_sha256=fingerprint, created_at=datetime.now(timezone.utc).isoformat(),
                engine=dict(name='PyPSA', version=pypsa.__version__, solver='HiGHS', solver_version=highspy.Highs().version(), status=status, termination=condition),
                summary=dict(hours=hours, snapshots=len(timeseries), demand_mwh=clean(demand_mwh), generation_mwh=clean(sum(g['generation_mwh'] for g in generators)),
                             operating_cost=clean(operating_cost), expansion_cost=clean(investment_cost), objective=clean(objective), co2_tonnes=clean(emissions),
                             cost_per_demand_mwh=clean(objective/demand_mwh), max_nodal_balance_error_mw=max_balance),
                generators=generators, lines=lines, storage=stores, timeseries=timeseries, warnings=warnings)


def action(req):
    # Some third-party import/solver paths print to stdout. Keep the desktop's
    # single-result JSON channel clean even on first import or solver failure.
    try:
        with redirect_stdout(sys.stderr):
            result = solve(req.get('study'), protocol.emit_progress)
        protocol.reply(result)
    except (ValueError, TypeError, KeyError) as exc:
        raise protocol.Unavailable(f'Could not plan the system: {exc}') from exc
