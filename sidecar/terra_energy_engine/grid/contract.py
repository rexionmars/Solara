"""
The store contract: what a database has to hold for Solara to read it, and the
reading of a store that holds it.

TWO KINDS OF STORE ANSWER, AND ONE DOES NOT. The store TERRA loads keeps the
Brazilian record in a schema named `br`, and everything this application first
knew how to read is written against it. A store prepared by anybody else, for
any other country, follows the contract in contract/v1.sql: a schema named
`solara` whose tables carry fixed names, columns and units. A database with
neither is a database, not a store, and is reported as that instead of as a
server that did not answer.

WHAT IS PRESENT IS WHAT THE STORE CAN DO. Every table of the contract but
solara.contract is optional, so a store with plants and no network draws the
plants and says the connection reading is not available, rather than failing.

THE BRAZILIAN RECORD IS NOT BENT INTO THE CONTRACT. Curtailment, the BDGD
register and the concessions exist only there and stay on TERRA's schema; the
contract covers what any country publishes: where the plants are, where the
network is, and which grounds have names.
"""

from __future__ import annotations

import json
from typing import Any

from terra_energy_engine import protocol

VERSION = 1

# powerplantmatching's fuel types, which the open plant databases already map onto.
FUELTYPES = (
    'Hydro', 'Solar', 'Wind', 'Nuclear', 'Natural Gas', 'Hard Coal', 'Lignite',
    'Oil', 'Solid Biomass', 'Biogas', 'Geothermal', 'Other',
)

# Per entity: the columns the readers use, and which of them is the geometry.
# A column missing from this list may be absent; one in it may not.
ENTITIES: dict[str, dict[str, Any]] = {
    'plant': {
        'table': 'solara.plant',
        'columns': ('id', 'name', 'fueltype', 'technology', 'capacity_mw',
                    'year_commissioned', 'operator', 'geom'),
        'geometry': 'POINT',
    },
    'substation': {
        'table': 'solara.substation',
        'columns': ('id', 'name', 'voltage_kv', 'operator', 'geom'),
        'geometry': 'POINT',
    },
    'line': {
        'table': 'solara.line',
        'columns': ('id', 'name', 'voltage_kv', 'capacity_mva', 'circuits',
                    'in_service', 'routed', 'geom'),
        'geometry': 'LINESTRING',
    },
    'boundary': {
        'table': 'solara.boundary',
        'columns': ('id', 'level', 'level_name', 'name', 'parent_id', 'geom'),
        'geometry': 'MULTIPOLYGON',
    },
}

NOT_A_STORE = (
    'Connected, but this database is not a Solara store: it has neither the '
    'contract (a schema named solara, see contract/v1.sql) nor the schema br '
    'that TERRA loads.'
)


def _exists(cur, relation: str) -> bool:
    cur.execute('SELECT to_regclass(%s)', (relation,))
    return cur.fetchone()[0] is not None


def profile(conn) -> str:
    """
    Which kind of store this is: 'terra', 'contract' or 'none'.

    TERRA'S SCHEMA WINS WHERE BOTH ARE PRESENT. It carries what the contract
    does not -- which plants the operator meters, and where each is joined --
    and a store holding both should not lose that for having gained the other.
    """
    with conn.cursor() as cur:
        if _exists(cur, 'br.plant'):
            return 'terra'
        if _exists(cur, 'solara.contract'):
            return 'contract'
    return 'none'


def require(conn, entity: str, what: str) -> None:
    """Refuse, in the reader's terms, a reading the store has no table for."""
    with conn.cursor() as cur:
        if not _exists(cur, ENTITIES[entity]['table']):
            raise protocol.Unavailable(
                f'This store has no {ENTITIES[entity]["table"]}, so {what} is '
                f'not available from it. The contract makes that table optional; '
                f'see contract/README.md for what it has to hold.')


def _extent(cur, tables) -> list[float] | None:
    """West, south, east, north of the first of `tables` that holds any geometry."""
    for table in tables:
        # The estimate from the index, where there is one: exact enough to
        # frame a map, and it does not read a country's worth of geometry.
        cur.execute(f'SELECT ST_XMin(e), ST_YMin(e), ST_XMax(e), ST_YMax(e) '
                    f'FROM (SELECT ST_Extent(geom) AS e FROM {table}) t')
        row = cur.fetchone()
        if row and row[0] is not None:
            return [round(float(v), 4) for v in row]
    return None


def _check_entity(cur, entity: str) -> dict[str, Any]:
    spec = ENTITIES[entity]
    schema, table = spec['table'].split('.')
    out: dict[str, Any] = {'entity': entity, 'table': spec['table'],
                           'present': False, 'rows': 0, 'problems': []}
    if not _exists(cur, spec['table']):
        return out
    out['present'] = True
    problems: list[str] = out['problems']

    cur.execute(
        'SELECT column_name FROM information_schema.columns '
        'WHERE table_schema = %s AND table_name = %s', (schema, table))
    have = {r[0] for r in cur.fetchall()}
    missing = [c for c in spec['columns'] if c not in have]
    if missing:
        problems.append(f'missing column{"s" if len(missing) > 1 else ""}: {", ".join(missing)}')
        # Counting and checking need the columns; what is missing is the finding.
        return out

    cur.execute(f'SELECT count(*) FROM {spec["table"]}')
    out['rows'] = int(cur.fetchone()[0])

    # A view over somebody's own table declares neither type nor SRID in the
    # catalogue, so the geometry is checked on the rows themselves.
    cur.execute(
        f'SELECT count(*) FILTER (WHERE ST_SRID(geom) <> 4326), '
        f'       count(*) FILTER (WHERE upper(GeometryType(geom)) <> %s), '
        f'       count(*) FILTER (WHERE geom IS NULL) '
        f'FROM {spec["table"]}', (spec['geometry'],))
    wrong_srid, wrong_type, unlocated = cur.fetchone()
    if wrong_srid:
        problems.append(f'{wrong_srid:,} geometries are not in EPSG:4326')
    if wrong_type:
        problems.append(f'{wrong_type:,} geometries are not {spec["geometry"]}')
    if unlocated and entity != 'plant':
        problems.append(f'{unlocated:,} rows have no geometry')
    if entity == 'plant':
        out['located'] = out['rows'] - int(unlocated)
        cur.execute(
            'SELECT count(*) FROM solara.plant WHERE NOT (fueltype = ANY(%s))',
            (list(FUELTYPES),))
        odd = cur.fetchone()[0]
        if odd:
            problems.append(f'{odd:,} plants have a fueltype outside the contract\'s list')
        cur.execute('SELECT count(*) FROM solara.plant WHERE capacity_mw <= 0')
        zero = cur.fetchone()[0]
        if zero:
            problems.append(f'{zero:,} plants have a capacity of zero or less; unknown is null')
    if entity == 'line':
        cur.execute('SELECT count(*) FROM solara.line WHERE in_service')
        out['in_service'] = int(cur.fetchone()[0])
    return out


def describe(conn) -> dict[str, Any]:
    """
    What kind of store this is and what it holds, entity by entity, with every
    departure from the contract said as the thing to fix.

    Never raises for a store that is merely incomplete or wrong: this is what
    the Grid store card shows to the person preparing it, and a traceback
    there is the one answer they cannot act on.
    """
    kind = profile(conn)
    out: dict[str, Any] = {
        'profile': kind, 'name': None, 'contract_version': None,
        # West, south, east, north of what the store holds: where the map
        # goes when asked for home, in place of a country written in the code.
        'extent': None,
        'entities': [], 'problems': [],
        'capabilities': {'plants': False, 'network': False, 'connection': False,
                         'boundaries': False, 'brazil': kind == 'terra'},
    }
    cap = out['capabilities']
    with conn.cursor() as cur:
        if kind == 'none':
            out['problems'].append(NOT_A_STORE)
            return out
        if kind == 'terra':
            out['name'] = 'TERRA store (Brazil: ANEEL, ONS)'
            cap.update(plants=True, network=True, connection=True)
            out['extent'] = _extent(cur, ('br.substation', 'br.plant'))
            return out

        cur.execute('SELECT version, name FROM solara.contract LIMIT 1')
        row = cur.fetchone()
        if row is None:
            out['problems'].append('solara.contract is empty: it needs one row naming the contract version and the store.')
        else:
            out['contract_version'], out['name'] = int(row[0]), row[1]
            if out['contract_version'] != VERSION:
                out['problems'].append(
                    f'This store follows contract version {out["contract_version"]}; '
                    f'this Solara reads version {VERSION}.')
        for entity in ENTITIES:
            # Each check in its own savepoint: a table that cannot be read at
            # all is a finding about that table, not the end of the report.
            try:
                with conn.transaction():
                    out['entities'].append(_check_entity(cur, entity))
            except Exception as e:  # noqa: BLE001 -- whatever the table did, it is reported
                out['entities'].append({
                    'entity': entity, 'table': ENTITIES[entity]['table'], 'present': True,
                    'rows': 0, 'problems': [f'could not be read: {str(e).strip().splitlines()[0]}']})

        try:
            with conn.transaction():
                out['extent'] = _extent(cur, tuple(
                    e['table'] for e in out['entities'] if e['present'] and e['rows'] and not e['problems']))
        except Exception:  # noqa: BLE001 -- an extent that cannot be measured is only a missing convenience
            out['extent'] = None

    usable = {e['entity']: e['present'] and not any('missing column' in p for p in e['problems'])
              for e in out['entities']}
    version_ok = out['contract_version'] == VERSION
    cap['plants'] = version_ok and usable.get('plant', False)
    cap['network'] = version_ok and (usable.get('line', False) or usable.get('substation', False))
    cap['connection'] = cap['network']
    cap['boundaries'] = version_ok and usable.get('boundary', False)
    return out


def counts(report: dict[str, Any]) -> dict[str, Any]:
    """The contract store's holdings in the shape grid_coverage has always answered in."""
    by = {e['entity']: e for e in report['entities']}
    plant, sub, line = by.get('plant', {}), by.get('substation', {}), by.get('line', {})
    return {
        'plants': {'registered': plant.get('rows', 0), 'with_geometry': plant.get('located', 0)},
        'network': {'substations': sub.get('rows', 0), 'lines_in_service': line.get('in_service', 0)},
    }


# ---- The layers ---------------------------------------------------------------------


def plants_geojson(conn, bbox=None, kinds=None, limit: int = 40000) -> dict:
    """
    solara.plant as the layer the map draws, in the shape the TERRA register
    answers in so one layer draws either.

    `metered` is false on every plant. It means "the operator's record covers
    this plant", which is a fact about TERRA's store; a contract store carries
    no such record, and saying false is saying exactly that.
    """
    require(conn, 'plant', 'the plant layer')
    where = ['p.geom IS NOT NULL']
    params: list = []
    if bbox:
        where.append('p.geom && ST_MakeEnvelope(%s, %s, %s, %s, 4326)')
        params.extend(float(v) for v in bbox)
    if kinds:
        where.append('p.fueltype = ANY(%s)')
        params.append(list(kinds))
    params.append(int(limit))
    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT p.id, p.name, p.fueltype, p.technology, p.capacity_mw,
                   p.year_commissioned, p.operator,
                   ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat
            FROM solara.plant p
            WHERE {' AND '.join(where)}
            ORDER BY p.capacity_mw DESC NULLS LAST
            LIMIT %s
        """, params)
        rows = cur.fetchall()
        cur.execute('SELECT count(*), count(geom) FROM solara.plant')
        registered, located = cur.fetchone()

    features = [{
        'type': 'Feature',
        'geometry': {'type': 'Point', 'coordinates': [round(lon, 5), round(lat, 5)]},
        'properties': {
            'ceg': pid, 'name': name, 'kind': fuel, 'technology': tech,
            'uf': None, 'municipality': None, 'operator': operator,
            'mw': None if mw is None else round(float(mw), 1),
            'since': None if year is None else str(year),
            'metered': False,
        },
    } for pid, name, fuel, tech, mw, year, operator, lon, lat in rows]
    return {
        'type': 'FeatureCollection',
        'features': features,
        'counts': {'returned': len(features), 'metered': 0, 'registered': registered,
                   'located': located, 'truncated': len(features) >= limit},
    }


def _line_facts(conn) -> tuple[bool, bool]:
    """Whether the store has lines, and whether every one of them is routed."""
    with conn.cursor() as cur:
        if not _exists(cur, 'solara.line'):
            return False, True
        cur.execute('SELECT bool_and(routed) FROM solara.line')
        routed = cur.fetchone()[0]
    return True, routed is None or bool(routed)


def network_geojson(conn, bbox=None, min_kv: float = 0.0) -> dict:
    """solara.line and solara.substation as the two network layers; either may be absent."""
    with conn.cursor() as cur:
        has_lines = _exists(cur, 'solara.line')
        has_subs = _exists(cur, 'solara.substation')
    if not has_lines and not has_subs:
        require(conn, 'line', 'the network layer')

    def clauses(alias: str) -> tuple[str, list]:
        where, params = [f'{alias}.geom IS NOT NULL'], []
        if bbox:
            where.append(f'{alias}.geom && ST_MakeEnvelope(%s, %s, %s, %s, 4326)')
            params.extend(float(v) for v in bbox)
        if min_kv:
            where.append(f'{alias}.voltage_kv >= %s')
            params.append(float(min_kv))
        return ' AND '.join(where), params

    line_rows: list = []
    sub_rows: list = []
    with conn.cursor() as cur:
        if has_lines:
            where, params = clauses('l')
            cur.execute(f"""
                SELECT l.id, l.name, l.voltage_kv, l.capacity_mva, l.in_service,
                       l.routed, ST_Length(l.geom::geography) / 1000.0,
                       -- Thinned to about 50 m for DRAWING only: a country's
                       -- routed lines are tens of megabytes vertex by vertex,
                       -- and the shell refuses a reply past 16. The readings
                       -- measure against the stored geometry, not this one.
                       ST_AsGeoJSON(ST_Simplify(l.geom, 0.0005, true), 4)
                FROM solara.line l WHERE {where}
                ORDER BY l.voltage_kv DESC NULLS LAST
            """, params)
            line_rows = cur.fetchall()
        if has_subs:
            where, params = clauses('s')
            cur.execute(f"""
                SELECT s.id, s.name, s.voltage_kv, s.operator, ST_X(s.geom), ST_Y(s.geom)
                FROM solara.substation s WHERE {where}
                ORDER BY s.voltage_kv DESC NULLS LAST
            """, params)
            sub_rows = cur.fetchall()

    lines = {'type': 'FeatureCollection', 'features': [{
        'type': 'Feature',
        'geometry': json.loads(g),
        'properties': {
            'id': lid, 'name': (name or '').strip(), 'kv': kv, 'mva': mva,
            'in_service': bool(on),
            # A routed line's length IS its published length; a straight
            # segment's is only the distance between its ends.
            'published_km': round(km, 1) if routed else None,
            'straight_km': None if routed else round(km, 1),
        },
    } for lid, name, kv, mva, on, routed, km, g in line_rows]}
    substations = {'type': 'FeatureCollection', 'features': [{
        'type': 'Feature',
        'geometry': {'type': 'Point', 'coordinates': [round(lon, 5), round(lat, 5)]},
        'properties': {'bus': sid, 'name': (name or '').strip(), 'kv': kv, 'uf': None,
                       'subsystem': None, 'operator': (operator or '').strip() or None},
    } for sid, name, kv, operator, lon, lat in sub_rows]}
    _, all_routed = _line_facts(conn)
    return {
        'lines': lines,
        'substations': substations,
        'counts': {
            'lines': len(line_rows),
            'lines_in_service': sum(1 for r in line_rows if r[4]),
            'lines_with_rating': sum(1 for r in line_rows if r[4] and r[3] is not None),
            'substations': len(sub_rows),
        },
        'route_factor': {'median': 1.0, 'p90': 1.0},
        'note': (
            'Lines are drawn along the route the store publishes.' if all_routed else
            'Some lines of this store are straight segments between their ends, '
            'not routes; a distance to one of those is a lower bound.'),
    }


# ---- The connection reading -----------------------------------------------------------


def connection_context(conn, aoi_geojson, max_km: float = 100.0) -> dict:
    """
    How far an area is from the network, from a contract store.

    PROXIMITY ONLY, and it says so. TERRA's store also knows where the plants
    already standing are joined and what they lost; the contract carries
    neither, so those halves come back empty rather than guessed. Measured
    from the area itself and not from its centroid, as the other reading is.
    """
    geom = json.dumps(aoi_geojson)
    subs: list = []
    lines: list = []
    with conn.cursor() as cur:
        has_lines = _exists(cur, 'solara.line')
        has_subs = _exists(cur, 'solara.substation')
        if not has_lines and not has_subs:
            require(conn, 'line', 'the connection reading')
        if has_subs:
            cur.execute("""
                WITH aoi AS (SELECT ST_GeomFromGeoJSON(%s) AS g)
                SELECT s.name, s.voltage_kv,
                       ST_Distance(s.geom::geography, aoi.g::geography) / 1000.0 AS km
                FROM solara.substation s, aoi
                WHERE ST_DWithin(s.geom::geography, aoi.g::geography, %s)
                ORDER BY km LIMIT 5
            """, (geom, max_km * 1000.0))
            subs = cur.fetchall()
        if has_lines:
            cur.execute("""
                WITH aoi AS (SELECT ST_GeomFromGeoJSON(%s) AS g)
                SELECT l.name, l.voltage_kv, l.capacity_mva,
                       ST_Distance(l.geom::geography, aoi.g::geography) / 1000.0 AS km
                FROM solara.line l, aoi
                WHERE l.in_service
                  AND ST_DWithin(l.geom::geography, aoi.g::geography, %s)
                ORDER BY km LIMIT 5
            """, (geom, max_km * 1000.0))
            lines = cur.fetchall()
            cur.execute('SELECT count(*), count(capacity_mva) FROM solara.line WHERE in_service')
            in_service, rated = cur.fetchone()
        else:
            in_service, rated = 0, 0
        cur.execute('SELECT name FROM solara.contract LIMIT 1')
        row = cur.fetchone()
    _, all_routed = _line_facts(conn)

    def reach(name, kv, km, mva=None, with_mva=False):
        out = {'name': (name or '').strip() or 'unnamed', 'distance_km': round(float(km), 2),
               'voltage_kv': None if kv is None else float(kv)}
        if with_mva:
            out['capacity_mva'] = None if mva is None else float(mva)
        return out

    sub_list = [reach(n, kv, km) for n, kv, km in subs]
    line_list = [reach(n, kv, km, mva, True) for n, kv, mva, km in lines]
    volts = [r['voltage_kv'] for r in sub_list + line_list if r['voltage_kv']]
    return {
        'reachable': bool(sub_list or line_list),
        'searched_km': max_km,
        'attachment': [], 'attached_bus_headroom': [],
        'neighbours': [], 'neighbour_bus_headroom': [],
        'nearest_substation': sub_list[0] if sub_list else None,
        'nearest_line': line_list[0] if line_list else None,
        'substations': sub_list,
        'lines': line_list,
        'highest_voltage_kv': max(volts, default=None),
        'capacity_published_fraction': round(rated / in_service, 3) if in_service else 0.0,
        'route_factor': {
            'median': 1.0, 'p90': 1.0,
            'note': ('Line distances are to the route the store publishes.' if all_routed else
                     'Some lines of this store are straight segments between their ends; '
                     'a distance to one of those is a lower bound.'),
        },
        'source': row[0] if row else 'contract store',
        'note': ('Proximity only: this store follows the contract, which carries no '
                 'record of where existing plants are joined.'),
    }


# ---- The boundaries -----------------------------------------------------------------


def boundaries(conn, level=None, parent=None, boundary_id=None) -> dict:
    """
    The store's named grounds: the list of one level (optionally under one
    parent) without shapes, or one boundary with its shape.

    The list carries no geometry because a country's municipalities are tens of
    megabytes, and a reader choosing one needs its name, not its outline.
    """
    require(conn, 'boundary', 'the catalogue of areas')
    with conn.cursor() as cur:
        if boundary_id is not None:
            cur.execute(
                'SELECT id, level, level_name, name, parent_id, ST_AsGeoJSON(geom, 5) '
                'FROM solara.boundary WHERE id = %s', (str(boundary_id),))
            r = cur.fetchone()
            if r is None:
                raise protocol.Unavailable(f'the store holds no boundary {boundary_id!r}')
            return {'boundary': {'id': r[0], 'level': r[1], 'level_name': r[2], 'name': r[3],
                                 'parent_id': r[4], 'geometry': json.loads(r[5])}}
        cur.execute(
            'SELECT level, min(level_name), count(*) FROM solara.boundary GROUP BY level ORDER BY level')
        levels = [{'level': lv, 'name': nm, 'count': n} for lv, nm, n in cur.fetchall()]
        where, params = [], []
        if level is not None:
            where.append('b.level = %s')
            params.append(int(level))
        if parent is not None:
            where.append('b.parent_id = %s')
            params.append(str(parent))
        cur.execute(f"""
            SELECT b.id, b.level, b.name, b.parent_id, p.name
            FROM solara.boundary b LEFT JOIN solara.boundary p ON p.id = b.parent_id
            {'WHERE ' + ' AND '.join(where) if where else ''}
            ORDER BY b.name
        """, params)
        places = [{'id': i, 'level': lv, 'name': nm, 'parent_id': pid, 'parent_name': pn}
                  for i, lv, nm, pid, pn in cur.fetchall()]
    return {'levels': levels, 'places': places}
