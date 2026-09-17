"""
The local store the Brazilian electrical record is read from.

A PostGIS database beside the application, loaded by TERRA (terra/grid/store.py
holds the schema and the loaders). It answers the two joins the record needs:
ONS publishes what a plant did with no geometry, ANEEL publishes where it is,
and an area drawn here reaches the first through the second.

READ ONLY. Nothing here creates, loads or refreshes anything, so this
application cannot leave the store in a state TERRA did not put it in.

WHICH DATABASE. The request's br_store_dsn, else TERRA_BR_DSN, else
postgresql:///terra_br: the local socket with the user's own role, the same
default TERRA uses, so both applications find one store without being told.
"""

from __future__ import annotations

from typing import Any

from terra_energy_engine import protocol

# Seconds to wait for the server to answer. TERRA waits indefinitely, so a
# server that accepts the socket and never replies holds the settings screen
# on "checking" until the shell's watchdog; a store on this machine answers in
# milliseconds or not at all.
CONNECT_TIMEOUT_S = 5

DEFAULT_DSN = 'postgresql:///terra_br'


class StoreUnreachable(protocol.Unavailable):
    """
    The database could not be opened, in the user's terms rather than psycopg's.

    Raised instead of letting psycopg.OperationalError escape, because it does
    not escape into a log -- it escapes onto the settings screen, where the
    reader is deciding what to install or start. A traceback there says the
    process failed; it does not say which of the three things a person has to
    do next. Every message this carries names one of them.
    """


def connect(req=None):
    """
    A connection to the store, or a failure that says what to do about it.

    psycopg is imported here rather than at module scope, so an action that
    never touches the store does not pay for the driver, and an installation
    without it still answers everything else.
    """
    import os

    try:
        import psycopg
    except ImportError as e:
        raise protocol.MissingDependency(
            'The grid store needs psycopg, which is not installed in the '
            'sidecar\'s interpreter. Install requirements.txt into it '
            '(.venv/bin/pip install -r requirements.txt).'
        ) from e

    dsn = (req or {}).get('br_store_dsn') or os.environ.get('TERRA_BR_DSN') or DEFAULT_DSN
    try:
        return psycopg.connect(dsn, connect_timeout=CONNECT_TIMEOUT_S)
    except psycopg.OperationalError as e:
        raise StoreUnreachable(_why_unreachable(e, dsn)) from e



def _why_unreachable(exc, dsn: str) -> str:
    """
    Which of the three failures this was, said as the action it needs.

    They are told apart by what libpq puts in the message, because psycopg
    raises one exception type for all of them. Matching text is fragile and is
    the price of a sentence someone can act on; an unmatched failure falls
    through to the driver's own words rather than to a guess.
    """
    text = str(exc).strip()
    lowered = text.lower()
    where = _dsn_summary(dsn)
    if 'does not exist' in lowered and 'database' in lowered:
        return (
            f'There is a PostgreSQL server at {where} but no database for the '
            f'grid record. It is created and loaded by TERRA.')
    if 'connection refused' in lowered or 'could not connect' in lowered:
        return (
            f'No PostgreSQL server answered at {where}. Start it, or point the '
            f'grid store at one that is running.')
    if 'timeout expired' in lowered:
        return (
            f'The PostgreSQL server at {where} did not answer within '
            f'{CONNECT_TIMEOUT_S} seconds.')
    if 'authentication' in lowered or 'password' in lowered:
        return (
            f'The PostgreSQL server at {where} refused these credentials.')
    return f'The grid store at {where} could not be opened: {text}'


def _dsn_summary(dsn: str) -> str:
    """The connection named without its password, for a message shown on screen."""
    import re

    return re.sub(r'://([^:/@]+):[^@]*@', r'://\1@', dsn)


def register_geojson(conn, bbox=None, kinds=None, limit: int = 40000) -> dict:
    """
    The plant register as a layer, so an area is drawn over something visible.

    THE MAP IS BARE AND THAT IS THE DEFECT THIS ANSWERS. Every question this
    slice takes is "what about the plants inside this polygon", and until the
    polygon is drawn nothing on screen says where a plant is. An area drawn
    over a solar farm the imagery plainly shows can return no plant at all, and
    an empty answer is then indistinguishable from a broken one. Drawing the
    register first makes the polygon a choice instead of a guess.

    `metered` IS THE POINT OF THE LAYER, NOT A DETAIL OF IT. ANEEL registers
    18,639 located photovoltaic enterprises; ONS meters 558 of them, three
    percent. Every action in this slice can only answer about those 558, so a
    layer that drew all 18,639 alike would invite an area over the other 97
    percent and give nothing back. The two populations are different questions
    and the map has to tell them apart.

    ONE POINT PER ENTERPRISE, which is what the register publishes and not what
    a plant is: a 40 MW array covering a square kilometre is a dot. So this is
    a layer of WHERE THE RECORD THINKS A PLANT IS, and it is drawn as points
    rather than footprints because footprints are not published and inventing
    them would be inventing the one thing the reader would trust it for.

    Returned whole rather than per viewport. The located register is 24,698
    points and about 4 MB of GeoJSON, which a map draws without help; a
    viewport query would add a round trip to every pan for a payload that fits
    in memory once.
    """

    where = ['p.geom IS NOT NULL']
    params: list = []
    if bbox:
        # west, south, east, north -- the order every GeoJSON bbox uses.
        where.append('p.geom && ST_MakeEnvelope(%s, %s, %s, %s, 4326)')
        params.extend(float(v) for v in bbox)
    if kinds:
        where.append('p.kind = ANY(%s)')
        params.append(list(kinds))
    params.append(int(limit))

    with conn.cursor() as cur:
        cur.execute(f"""
            WITH metered AS (
                -- In the record either directly or through the cluster ONS
                -- curtails, because the curtailment record names clusters and
                -- the detail record names plants, and a plant reached only by
                -- the second is still one this slice can answer about.
                -- DISTINCT BEFORE THE UNION, and it is 7.5x. Without it
                -- the union deduplicates 19,088,880 detail rows against 680
                -- cluster rows and takes 4.1 seconds; with it the index on
                -- ceg_core yields the 560 distinct values and it takes 0.54.
                -- The set is identical either way -- UNION already dedupes --
                -- so this is only about how much the planner is asked to sort.
                SELECT DISTINCT ceg_core FROM br.pv_detail
                UNION
                SELECT ceg_core FROM br.plant_cluster
            )
            SELECT p.ceg_core, p.name, p.kind, p.uf, p.municipality,
                   p.capacity_kw, p.operation_start,
                   (m.ceg_core IS NOT NULL) AS metered,
                   ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat
            FROM br.plant p
            LEFT JOIN metered m USING (ceg_core)
            WHERE {' AND '.join(where)}
            ORDER BY p.capacity_kw DESC NULLS LAST
            LIMIT %s
        """, params)
        cols = [d.name for d in cur.description]
        rows = [dict(zip(cols, r, strict=True)) for r in cur.fetchall()]

    features: list[dict[str, Any]] = []
    for r in rows:
        features.append({
            'type': 'Feature',
            'geometry': {'type': 'Point',
                         'coordinates': [round(r['lon'], 5),
                                         round(r['lat'], 5)]},
            'properties': {
                'ceg': r['ceg_core'],
                'name': r['name'],
                'kind': r['kind'],
                'uf': r['uf'],
                'municipality': r['municipality'],
                'mw': (None if r['capacity_kw'] is None
                       else round(r['capacity_kw'] / 1000.0, 1)),
                'since': (None if r['operation_start'] is None
                          else str(r['operation_start'])),
                'metered': bool(r['metered']),
            },
        })

    with conn.cursor() as cur:
        cur.execute('SELECT count(*), count(geom) FROM br.plant')
        registered, located = cur.fetchone()
    return {
        'type': 'FeatureCollection',
        'features': features,
        # Counted over what was RETURNED, not over the register, because a
        # bbox or a kind filter makes those different numbers and a reader
        # comparing the legend to the map needs the one the map is showing.
        'counts': {
            'returned': len(features),
            'metered': sum(1 for f in features if f['properties']['metered']),
            'registered': registered,
            'located': located,
            'truncated': len(features) >= limit,
        },
    }


def network_geojson(conn, bbox=None, min_kv: float = 0.0) -> dict:
    """
    The transmission network as two layers, so a site's distance to it is
    visible before it is measured.

    TWO COLLECTIONS AND NOT ONE. A line is drawn as a line and a bus as a point,
    and MapLibre needs them apart; merging them would make the caller split
    them again by geometry type, which is a decision this already made.

    THE GEOMETRY IS THE SEGMENT BETWEEN TERMINALS, NOT THE ROUTE, and that has
    to travel with the layer rather than sit in documentation. ONS publishes a
    line's two ends and its length and never its path, so a line drawn from
    this is in the right place and on the wrong course. Measured against the
    published lengths, the real conductor runs 7.7 percent longer than its
    segment at the median and 40.8 percent at the ninetieth percentile.

    IT IS TRANSMISSION AND NOT DISTRIBUTION. The lines in service run 230 kV and
    above; the substations reach down to 69 kV because a 500/230/138 station has
    all three buses, but the circuits joining anything below 230 are not in this
    register. A site that cannot reach 230 kV is not thereby unconnectable --
    it is unanswerable from here.

    capacity_mva is null on 41 percent of lines in service. Null is a rating
    the register does not publish, never a line of no capacity, and no
    published value is zero.
    """
    lines_where = ['l.geom IS NOT NULL']
    subs_where = ['s.geom IS NOT NULL']
    lp: list = []
    sp: list = []
    if bbox:
        lines_where.append('l.geom && ST_MakeEnvelope(%s, %s, %s, %s, 4326)')
        lp.extend(float(v) for v in bbox)
        subs_where.append('s.geom && ST_MakeEnvelope(%s, %s, %s, %s, 4326)')
        sp.extend(float(v) for v in bbox)
    if min_kv:
        lines_where.append('l.voltage_kv >= %s')
        lp.append(float(min_kv))
        subs_where.append('s.voltage_kv >= %s')
        sp.append(float(min_kv))

    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT l.line_id, l.name, l.voltage_kv, l.capacity_mva,
                   l.in_service, l.published_length_km, l.straight_length_km,
                   ST_AsGeoJSON(l.geom) AS g
            FROM br.transmission_line l
            WHERE {' AND '.join(lines_where)}
            ORDER BY l.voltage_kv DESC NULLS LAST
        """, lp)
        cols = [d.name for d in cur.description]
        line_rows = [dict(zip(cols, r, strict=True)) for r in cur.fetchall()]

        cur.execute(f"""
            SELECT s.bus, s.name, s.voltage_kv, s.uf, s.subsystem, s.operator,
                   ST_X(s.geom) AS lon, ST_Y(s.geom) AS lat
            FROM br.substation s
            WHERE {' AND '.join(subs_where)}
            ORDER BY s.voltage_kv DESC NULLS LAST
        """, sp)
        cols = [d.name for d in cur.description]
        sub_rows = [dict(zip(cols, r, strict=True)) for r in cur.fetchall()]

    import json as _json

    lines = {
        'type': 'FeatureCollection',
        'features': [{
            'type': 'Feature',
            'geometry': _json.loads(r['g']),
            'properties': {
                'id': r['line_id'],
                'name': (r['name'] or '').strip(),
                'kv': r['voltage_kv'],
                'mva': r['capacity_mva'],
                'in_service': bool(r['in_service']),
                # Both lengths, because their ratio is the route factor for
                # THIS line and a reader measuring a distance to it needs the
                # one that applies rather than the fleet median.
                'published_km': r['published_length_km'],
                'straight_km': (None if r['straight_length_km'] is None
                                else round(r['straight_length_km'], 1)),
            },
        } for r in line_rows],
    }
    substations = {
        'type': 'FeatureCollection',
        'features': [{
            'type': 'Feature',
            'geometry': {'type': 'Point',
                         'coordinates': [round(r['lon'], 5),
                                         round(r['lat'], 5)]},
            'properties': {
                'bus': r['bus'],
                'name': (r['name'] or '').strip(),
                'kv': r['voltage_kv'],
                'uf': r['uf'],
                'subsystem': r['subsystem'],
                'operator': (r['operator'] or '').strip() or None,
            },
        } for r in sub_rows],
    }
    rated = sum(1 for r in line_rows
                if r['in_service'] and r['capacity_mva'] is not None)
    in_service = sum(1 for r in line_rows if r['in_service'])
    return {
        'lines': lines,
        'substations': substations,
        'counts': {
            'lines': len(line_rows),
            'lines_in_service': in_service,
            'lines_with_rating': rated,
            'substations': len(sub_rows),
        },
        'route_factor': {'median': 1.077, 'p90': 1.408},
        'note': (
            'Lines are drawn as the straight segment between their terminals, '
            'which is all the register publishes. The conductor runs about 8 '
            'percent longer at the median and 41 percent at the ninetieth '
            'percentile. Transmission only: circuits below 230 kV are not in '
            'this register.'
        ),
    }


def coverage(conn):
    """
    What the store holds, per dataset: periods, rows and the revision of each.

    A store is only trustworthy if it can say what is in it. Read straight from
    br.source_file rather than counted from the fact tables, so a period whose
    rows failed to load reports as absent instead of as present and empty.
    """
    with conn.cursor() as cur:
        cur.execute(
            'SELECT dataset, count(*), min(period), max(period), '
            'sum(row_count), max(loaded_utc) FROM br.source_file '
            'GROUP BY dataset ORDER BY dataset')
        return [
            {'dataset': d, 'periods': n, 'from': lo, 'to': hi,
             'rows': int(rows or 0), 'loaded_utc': when}
            for d, n, lo, hi, rows, when in cur.fetchall()
        ]
