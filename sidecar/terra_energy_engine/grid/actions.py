"""
The questions the shell can ask about the electrical system.

Siblings of energy/actions.py, not extensions of it: each answers about the
system a site would join, none about its resource, and none appends itself to
an action that does. Every one needs the store; there is no file-reading
fallback, so an installation without it gets a failure that says what is
missing. Carried over from TERRA's terra/grid/actions.py, with its action names
and result shapes, so a request moves between the two programs unchanged.
"""

from __future__ import annotations

import json
import sys

from terra_energy_engine import protocol
from terra_energy_engine.protocol import Request


def _reply(result: dict) -> None:
    # default=str: dates and Decimals come back from psycopg as themselves.
    sys.stdout.write(json.dumps(result, default=str, allow_nan=False))
    sys.stdout.flush()


def _window(req: Request, conn, dataset: str = 'pv_curtailment_detail'):
    """
    The window a reading covers: what the caller asked for, bounded by what the
    store holds. The record begins in 2024-04, so a request outside it is
    refused rather than answered over a fraction reported as whole.
    """
    from terra_energy_engine.grid import store

    held = [c for c in store.coverage(conn) if c['dataset'] == dataset]
    if not held:
        raise protocol.Unavailable(
            f'the store holds no {dataset!r}; it is loaded in TERRA with '
            f'terra.grid.store.load_period.')
    lo, hi = f"{held[0]['from']}-01", f"{held[0]['to']}-28"
    start = max(str(req.get('start') or lo), lo)
    end = min(str(req.get('end') or hi), hi)
    if start > end:
        raise protocol.Unavailable(
            f'the requested window {start}..{end} lies outside the record, '
            f'which runs {lo}..{hi}')
    return start, end, {'requested': [req.get('start'), req.get('end')],
                        'record': [lo, hi], 'used': [start, end]}


def _aoi(req: Request):
    if not req.get('polygon_geojson'):
        protocol.fail('this action needs polygon_geojson')
    return req['polygon_geojson']


def _padded_bbox(req: Request, default_pad: float):
    """The caller's bbox, else the AOI's envelope padded by pad_degrees, else None."""
    bbox = req.get('bbox')
    if bbox is None and req.get('polygon_geojson'):
        pad = float(protocol.request_number(req, 'pad_degrees', default_pad))
        xs, ys = [], []
        for ring in req['polygon_geojson'].get('coordinates') or []:
            for pt in ring:
                xs.append(float(pt[0]))
                ys.append(float(pt[1]))
        if xs:
            bbox = [min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad]
    return bbox


# The radius the connection reading searches when the request names none.
SEARCH_RADIUS_KM = 100.0


def grid_congestion(req: Request) -> None:
    """
    The transmission network within reach of an area, and what the plants
    already on it experienced.

    The two are reported side by side and never combined: distance says
    whether a connection is plausible, the curtailment at the plants already
    connected says what one would be worth.

    THE SECOND HALF MAY BE MISSING WHERE THE FIRST IS NOT. A store with the
    registers loaded and no curtailment record, or no rollup over it, still
    answers where the network is; the reading then carries why the other half
    is absent instead of failing whole. TERRA fails whole.
    """
    from terra_energy_engine.grid import congestion, curtailment, store

    radius = float(protocol.request_positive(req, 'search_radius_km', SEARCH_RADIUS_KM))
    protocol.emit_progress(10, 'opening the grid store')
    with store.connect(req) as conn:
        protocol.emit_progress(35, 'transmission register')
        reach = congestion.connection_context(conn, _aoi(req), max_km=radius)
        protocol.emit_progress(70, 'curtailment at connected plants')
        experienced = None
        window = None
        absent = None
        try:
            start, end, window = _window(req, conn)
            experienced = curtailment.curtailment_context(conn, _aoi(req), start, end)
        except protocol.Unavailable as e:
            absent = str(e)

    protocol.emit_progress(100, 'done')
    _reply({
        'grid_congestion': {
            'connection': reach,
            'curtailment_at_connected_plants': experienced,
            'curtailment_absent': absent,
            'window': window,
            'note': (
                'Proximity and curtailment are reported apart and must not be '
                'summed into a score. A site 1.3 km from a 440 kV line rated '
                '2,664 MVA can still lose 14 percent of its output, because '
                'the binding constraint is upstream of the connection.'
            ),
        }
    })


def grid_plants(req: Request) -> None:
    """
    The plant register as a layer, so an area is drawn over something visible.
    A register is not a reading: it takes no window, and an AOI only narrows
    the extent to its neighbourhood.
    """
    from terra_energy_engine.grid import store

    kinds = req.get('kinds')
    if isinstance(kinds, str):
        kinds = [kinds]
    bbox = _padded_bbox(req, 0.25)

    protocol.emit_progress(20, 'opening the grid store')
    with store.connect(req) as conn:
        protocol.emit_progress(50, 'reading the register')
        layer = store.register_geojson(
            conn, bbox=bbox, kinds=kinds,
            limit=int(protocol.request_positive(req, 'limit', 40000, cast=int)))

    protocol.emit_progress(100, 'done')
    _reply({
        'grid_plants': {
            'geojson': layer,
            'counts': layer['counts'],
            'bbox': bbox,
            'note': (
                'A point is one enterprise as ANEEL registers it, not a '
                'footprint: a 40 MW array over a square kilometre is one dot. '
                'Only the metered plants are in the operational record.'
            ),
        }
    })


def grid_network(req: Request) -> None:
    """
    The transmission network as a layer, sibling of grid_plants and apart from
    it: the network is a megabyte and the register several, and a caller
    looking at one does not always want the other.
    """
    from terra_energy_engine.grid import store

    bbox = _padded_bbox(req, 1.0)
    protocol.emit_progress(20, 'opening the grid store')
    with store.connect(req) as conn:
        protocol.emit_progress(50, 'reading the network register')
        layer = store.network_geojson(
            conn, bbox=bbox, min_kv=float(protocol.request_number(req, 'min_kv', 0.0)))

    protocol.emit_progress(100, 'done')
    _reply({'grid_network': layer})


def grid_coverage(req: Request) -> None:
    """
    What the store holds, and which revision of it. The record is revised in
    batches, so a figure is a figure about one revision, and this is what says
    which.
    """
    from terra_energy_engine.grid import store

    with store.connect(req) as conn:
        held = store.coverage(conn)
        with conn.cursor() as cur:
            cur.execute('SELECT count(*), count(geom) FROM br.plant')
            plants, located = cur.fetchone()
            cur.execute('SELECT count(*) FROM br.substation')
            substations = cur.fetchone()[0]
            cur.execute('SELECT count(*) FROM br.transmission_line WHERE in_service')
            lines = cur.fetchone()[0]
            cur.execute('SELECT count(*), count(*) FILTER (WHERE identical) '
                        'FROM br.load_conflict')
            conflicts, identical = cur.fetchone()

    _reply({
        'grid_coverage': {
            'datasets': held,
            'plants': {'registered': plants, 'with_geometry': located},
            'network': {'substations': substations, 'lines_in_service': lines},
            'load_conflicts': {'total': conflicts, 'identical': identical,
                               'note': (
                                   'Instants where one plant had two rows. The '
                                   'first was kept; br.load_conflict records '
                                   'every choice.')},
        }
    })


def demand_area(req: Request) -> None:
    """
    What the area consumes, and what it already generates behind the meter.

    A sibling of grid_congestion and not a half of it: that one reads what the
    network could take from a plant here, this one reads what the place already
    draws from it. They are reported apart because they come from different
    registers, on different dates, at different resolutions.
    """
    from terra_energy_engine.grid import demand, store

    from pathlib import Path

    # Before the store: a request without an area is refused by the request,
    # not by the database.
    aoi = _aoi(req)
    # Where the layer is written. Absent, the reading answers in figures alone,
    # which is what a caller without a results directory gets.
    work_dir = req.get('work_dir')
    work_dir = Path(work_dir) if work_dir else None
    protocol.emit_progress(10, 'opening the grid store')
    with store.connect(req) as conn:
        protocol.emit_progress(40, 'consumer units in the area')
        context = demand.demand_context(conn, aoi, req, work_dir)

    protocol.emit_progress(100, 'done')
    _reply({'demand_area': context})


def grid_concessions(req: Request) -> None:
    """
    Where each register the store holds reaches, as a layer.

    Takes no area and no window, like demand_towns: it is read once, so the
    map can say where a demand reading is answerable before any ground is
    chosen.
    """
    from terra_energy_engine.grid import demand, store

    protocol.emit_progress(20, 'opening the grid store')
    with store.connect(req) as conn:
        demand._require_schema(conn)
        protocol.emit_progress(55, 'where each register reaches')
        layer = demand.concessions(conn)

    protocol.emit_progress(100, 'done')
    _reply({'grid_concessions': layer})


def demand_towns(req: Request) -> None:
    """
    What each municipality of the store consumes, as a layer.

    A layer and not a reading: it takes no area and no window, and it is read
    once so the map says where consumption is before anything is chosen.

    EVERY REGISTER, NOT ONE. A reading is about a ground the reader chose, so
    it may refuse to guess which register that ground belongs to. A layer is
    the opposite: it is drawn BEFORE any ground is chosen, so the question
    "which one is this about" has no answer yet and asking it refuses the
    whole layer -- which is what a store with two distributors loaded used to
    get. Each municipality carries the register it came from instead.

    The latest year per distributor, because two base years of one register
    are the same municipalities twice.
    """
    from terra_energy_engine.grid import demand, store

    protocol.emit_progress(20, 'opening the grid store')
    with store.connect(req) as conn:
        demand._require_schema(conn)
        held = demand.holdings(conn)
        if not held:
            raise protocol.Unavailable(
                'bdgd.unidade_ponto is empty; load a distributor with '
                'bdgd_para_postgis.py before asking where consumption is.')

        # A request may still name one, which is how a caller asks for less.
        want_dist = req.get('distribuidora')
        want_year = req.get('ano')
        wanted = [h for h in held
                  if (not want_dist or h['distribuidora'] == want_dist)
                  and (not want_year or h['ano'] == int(want_year))]
        if not wanted:
            names = ', '.join(f"{h['distribuidora']} {h['ano']}" for h in held)
            raise protocol.Unavailable(
                f'the store holds no {want_dist or "any"} for '
                f'{want_year or "any year"}. It holds: {names}.')
        latest: dict[str, int] = {}
        for h in wanted:
            latest[h['distribuidora']] = max(latest.get(h['distribuidora'], 0), h['ano'])

        protocol.emit_progress(55, 'consumption by municipality')
        registros = []
        municipios = []
        ufs: set[str] = set()
        unit = 'MWh/ano'
        nota = ''
        for dist, ano in sorted(latest.items()):
            one = demand.towns(conn, dist, ano)
            registros.append({'distribuidora': dist, 'ano': ano})
            ufs.update(one['ufs'])
            unit = one['unit']
            nota = one['nota']
            for row in one['municipios']:
                municipios.append({**row, 'distribuidora': dist, 'ano': ano})

    municipios.sort(key=lambda r: -r['energia_ano_mwh'])
    protocol.emit_progress(100, 'done')
    _reply({'demand_towns': {
        'registros': registros,
        'ufs': sorted(ufs),
        'municipios': municipios,
        'unit': unit,
        'nota': nota,
        'holdings': held,
    }})
