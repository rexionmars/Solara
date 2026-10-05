#!/usr/bin/env python3
"""
Prepare a Solara store: a PostGIS database that follows contract/v1.sql.

Solara never writes to a store; this script is how one gets written. It is a
starting point, not the only way in: anything that fills the contract's tables
(or defines views with their names) makes a store.

    load.py init        --dsn DSN --name "Italia: WRI + OSM"
    load.py plants      --dsn DSN --csv plants.csv --format wri [--country ITA]
    load.py boundaries  --dsn DSN --geojson regions.geojson --level 1 \\
                        --level-name Region --id-field reg_istat_code --name-field reg_name
    load.py boundaries-world --dsn DSN --country ITA [--levels 1,2]
    load.py osm         --dsn DSN --country IT [--with-plants]
    load.py check       --dsn DSN

Run it with the sidecar's interpreter (.venv/bin/python3 contract/load.py ...),
which has psycopg and requests. The database has to exist already
(createdb solara_it).

UNITS ARE CONVERTED HERE, ONCE, and never in Solara: volts to kV, kW and GW to
MW, each source's fuel names to the contract's list.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'sidecar'))

from terra_energy_engine.grid import contract  # noqa: E402

# ---- Fuel names ---------------------------------------------------------------------

# Each source's own words, lowered, onto the contract's list. What is not here
# is 'Other': a wrong fuel is worse than an unnamed one.
FUEL = {
    'hydro': 'Hydro', 'water': 'Hydro',
    'solar': 'Solar', 'pv': 'Solar', 'photovoltaic': 'Solar',
    'wind': 'Wind',
    'nuclear': 'Nuclear',
    'gas': 'Natural Gas', 'natural gas': 'Natural Gas', 'fossil gas': 'Natural Gas',
    'coal': 'Hard Coal', 'hard coal': 'Hard Coal', 'bituminous': 'Hard Coal',
    'lignite': 'Lignite', 'brown coal': 'Lignite',
    'oil': 'Oil', 'petcoke': 'Oil', 'diesel': 'Oil',
    'biomass': 'Solid Biomass', 'solid biomass': 'Solid Biomass', 'wood': 'Solid Biomass',
    'biogas': 'Biogas', 'biofuel': 'Biogas',
    'geothermal': 'Geothermal',
}


def fueltype(raw: str | None) -> str:
    first = re.split(r'[;,/]', (raw or '').strip().lower())[0].strip()
    if (raw or '').strip() in contract.FUELTYPES:
        return raw.strip()
    return FUEL.get(first, 'Other')


def number(raw) -> float | None:
    try:
        v = float(str(raw).strip())
    except (TypeError, ValueError):
        return None
    return v if v == v else None


# ---- init ---------------------------------------------------------------------------


def connect(dsn: str):
    import psycopg

    return psycopg.connect(dsn)


def init(args) -> None:
    with connect(args.dsn) as conn, conn.cursor() as cur:
        cur.execute((HERE / 'v1.sql').read_text())
        cur.execute('DELETE FROM solara.contract')
        cur.execute(
            'INSERT INTO solara.contract (version, name, sources, notes) VALUES (%s, %s, %s, %s)',
            (contract.VERSION, args.name, args.sources, args.notes))
    print(f'contract v{contract.VERSION} created: {args.name}')


def credit(cur, source: str) -> None:
    """Add a source to the store's own account of where it came from."""
    cur.execute(
        "UPDATE solara.contract SET sources = CASE WHEN sources IS NULL OR sources = '' THEN %s "
        "WHEN position(%s in sources) > 0 THEN sources ELSE sources || '; ' || %s END",
        (source, source, source))


# ---- plants -------------------------------------------------------------------------

# Column names per source format: id, name, fuel, technology, capacity (MW),
# latitude, longitude, year, operator, and the column a country filter reads.
PLANT_FORMATS = {
    # WRI Global Power Plant Database.
    'wri': dict(id='gppd_idnr', name='name', fuel='primary_fuel', technology=None,
                mw='capacity_mw', lat='latitude', lon='longitude',
                year='commissioning_year', operator='owner', country='country'),
    # powerplantmatching's own export.
    'ppm': dict(id='projectID', name='Name', fuel='Fueltype', technology='Technology',
                mw='Capacity', lat='lat', lon='lon',
                year='DateIn', operator=None, country='Country'),
}


def plants(args) -> None:
    f = PLANT_FORMATS[args.format]
    rows = []
    with open(args.csv, newline='', encoding='utf-8-sig') as fh:
        for i, r in enumerate(csv.DictReader(fh)):
            if args.country and (r.get(f['country']) or '').strip() != args.country:
                continue
            lat, lon = number(r.get(f['lat'])), number(r.get(f['lon']))
            located = lat is not None and lon is not None and abs(lat) <= 90 and abs(lon) <= 180
            mw = number(r.get(f['mw']))
            year = number(r.get(f['year'])) if f['year'] else None
            rows.append((
                f'{args.format}:{(r.get(f["id"]) or "").strip() or i}',
                (r.get(f['name']) or '').strip() or None,
                fueltype(r.get(f['fuel'])),
                ((r.get(f['technology']) or '').strip() or None) if f['technology'] else None,
                mw if mw and mw > 0 else None,
                int(year) if year and 1800 < year < 2200 else None,
                ((r.get(f['operator']) or '').strip() or None) if f['operator'] else None,
                args.source or args.format.upper(),
                lon if located else None, lat if located else None,
            ))
    with connect(args.dsn) as conn, conn.cursor() as cur:
        if args.replace:
            cur.execute('DELETE FROM solara.plant WHERE id LIKE %s', (f'{args.format}:%',))
        cur.executemany(
            """
            INSERT INTO solara.plant (id, name, fueltype, technology, capacity_mw,
                                      year_commissioned, operator, source, geom)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s,
                    CASE WHEN %s::float8 IS NULL THEN NULL
                         ELSE ST_SetSRID(ST_MakePoint(%s, %s), 4326) END)
            ON CONFLICT (id) DO NOTHING
            """, [(*r[:8], r[8], r[8], r[9]) for r in rows])
        credit(cur, args.source or args.format.upper())
    print(f'{len(rows):,} plants loaded from {args.csv}')


# ---- boundaries ---------------------------------------------------------------------


def boundaries(args) -> None:
    data = json.loads(Path(args.geojson).read_text(encoding='utf-8'))
    rows = []
    for ft in data['features']:
        p = ft.get('properties') or {}
        if ft.get('geometry') is None or p.get(args.id_field) is None:
            continue
        parent = p.get(args.parent_field) if args.parent_field else None
        rows.append((
            f'{args.level}:{p[args.id_field]}',
            args.level, args.level_name, str(p.get(args.name_field) or p[args.id_field]),
            None if parent is None else f'{args.level - 1}:{parent}',
            json.dumps(ft['geometry']),
        ))
    with connect(args.dsn) as conn, conn.cursor() as cur:
        cur.execute('DELETE FROM solara.boundary WHERE level = %s', (args.level,))
        cur.executemany(
            """
            INSERT INTO solara.boundary (id, level, level_name, name, parent_id, geom)
            VALUES (%s, %s, %s, %s, %s,
                    -- Repaired and reduced to its polygons: published boundaries
                    -- carry self-intersections often enough to matter.
                    ST_Multi(ST_CollectionExtract(ST_MakeValid(
                        ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)), 3)))
            ON CONFLICT (id) DO NOTHING
            """, rows)
        if args.source:
            credit(cur, args.source)
    print(f'{len(rows):,} boundaries loaded at level {args.level} ({args.level_name})')


def boundaries_world(args) -> None:
    """
    A country's boundaries from geoBoundaries, for when you have no files of
    your own: the same source Solara's catalogue reads with no store connected,
    loaded here so the store carries them and a reading can be joined to them.
    """
    from terra_energy_engine.world import boundaries as world

    iso = args.country.upper()
    cache = Path.home() / '.cache' / 'terra-energy-engine' / 'boundaries'
    cache.mkdir(parents=True, exist_ok=True)
    published = {lv['level']: lv for lv in world.levels(cache, iso) if lv['level'] > 0}
    wanted = [int(v) for v in args.levels.split(',')] if args.levels else sorted(published)
    with connect(args.dsn) as conn, conn.cursor() as cur:
        for level in wanted:
            if level not in published:
                raise SystemExit(f'geoBoundaries publishes no level {level} for {iso}; it has {sorted(published)}')
            name = published[level]['name'] or f'Level {level}'
            rows = []
            for i, ft in enumerate(world._features(cache, iso, level)):
                p = ft.get('properties') or {}
                if ft.get('geometry') is None:
                    continue
                rows.append((f'{level}:{p.get("shapeID") or i}', level, name,
                             str(p.get('shapeName') or f'{iso} {i + 1}'), json.dumps(ft['geometry'])))
            cur.execute('DELETE FROM solara.boundary WHERE level = %s', (level,))
            cur.executemany(
                """
                INSERT INTO solara.boundary (id, level, level_name, name, geom)
                VALUES (%s, %s, %s, %s, ST_Multi(ST_CollectionExtract(ST_MakeValid(
                    ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)), 3)))
                ON CONFLICT (id) DO NOTHING
                """, rows)
            # The source names no parent, so each boundary's is the one of the
            # level above that holds a point inside it.
            cur.execute(
                """
                UPDATE solara.boundary c SET parent_id = p.id
                FROM solara.boundary p
                WHERE c.level = %s AND p.level = %s
                  AND ST_Contains(p.geom, ST_PointOnSurface(c.geom))
                """, (level, level - 1))
            print(f'{len(rows):,} boundaries loaded at level {level} ({name})')
        credit(cur, world.CREDIT)


# ---- OpenStreetMap ------------------------------------------------------------------

OVERPASS = (
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
)


def overpass(query: str, timeout: int) -> dict:
    import requests

    last: Exception | None = None
    for url in OVERPASS:
        try:
            r = requests.post(url, data={'data': query}, timeout=timeout + 30,
                              headers={'User-Agent': 'solara-store-loader'})
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001 -- the next mirror is the retry
            print(f'  {url}: {str(e).splitlines()[0][:120]}', file=sys.stderr)
            last = e
    raise SystemExit(f'no Overpass server answered: {last}')


def kilovolts(raw: str | None) -> float | None:
    """OSM writes voltage in volts, several of them separated by semicolons; the highest is the line's."""
    volts = [number(v) for v in re.split(r'[;,]', raw or '')]
    volts = [v for v in volts if v]
    return round(max(volts) / 1000.0, 3) if volts else None


def megawatts(raw: str | None) -> float | None:
    """'500 MW', '1.2 GW', '800 kW'; 'yes' and anything unreadable is unknown."""
    m = re.match(r'\s*([\d.,]+)\s*([kMG]?W)', raw or '', re.I)
    if not m:
        return None
    v = number(m.group(1).replace(',', '.'))
    if v is None:
        return None
    unit = m.group(2).lower()
    return round(v * {'kw': 0.001, 'mw': 1.0, 'gw': 1000.0}.get(unit, 0.000001), 3) or None


def osm(args) -> None:
    scope = f'area["ISO3166-1"="{args.country}"][admin_level=2]->.a;'
    t = args.timeout

    def ask(what: str, body: str, out: str) -> list[dict]:
        print(f'asking OpenStreetMap for {what} in {args.country} ...')
        got = overpass(f'[out:json][timeout:{t}];{scope}({body});{out}', t).get('elements', [])
        print(f'  {len(got):,} elements')
        return got

    lines = []
    for el in ask('lines', 'way["power"~"^(line|cable)$"](area.a);', 'out tags geom;') if args.only != 'substations' else []:
        tags, pts = el.get('tags', {}), el.get('geometry') or []
        kv = kilovolts(tags.get('voltage'))
        if len(pts) < 2 or (args.min_kv and (kv is None or kv < args.min_kv)):
            continue
        circuits = number(tags.get('circuits'))
        lines.append((
            f'osm:way/{el["id"]}', tags.get('name') or tags.get('ref'), kv,
            int(circuits) if circuits else None, tags.get('operator'),
            json.dumps({'type': 'LineString', 'coordinates': [[p['lon'], p['lat']] for p in pts]}),
        ))

    subs = []
    # Not the kiosks and pole transformers of the low-voltage network, which
    # OSM also tags as substations: a country has tens of thousands of them,
    # and none is where a plant connects.
    stations = 'nwr["power"="substation"]["substation"!="minor_distribution"](area.a);'
    for el in ask('substations', stations, 'out tags center;') if args.only != 'lines' else []:
        tags = el.get('tags', {})
        at = el if el['type'] == 'node' else el.get('center') or {}
        kv = kilovolts(tags.get('voltage'))
        if 'lat' not in at or (args.min_kv and (kv is None or kv < args.min_kv)):
            continue
        subs.append((f'osm:{el["type"]}/{el["id"]}', tags.get('name'), kv, tags.get('operator'),
                     at['lon'], at['lat']))

    plant_rows = []
    if args.with_plants:
        for el in ask('plants', 'nwr["power"="plant"](area.a);', 'out tags center;'):
            tags = el.get('tags', {})
            at = el if el['type'] == 'node' else el.get('center') or {}
            if 'lat' not in at:
                continue
            start = re.match(r'(\d{4})', tags.get('start_date') or '')
            plant_rows.append((
                f'osm:{el["type"]}/{el["id"]}', tags.get('name'), fueltype(tags.get('plant:source')),
                tags.get('plant:method'), megawatts(tags.get('plant:output:electricity')),
                int(start.group(1)) if start else None, tags.get('operator'), at['lon'], at['lat']))

    with connect(args.dsn) as conn, conn.cursor() as cur:
        if args.only != 'substations':
            cur.execute("DELETE FROM solara.line WHERE id LIKE 'osm:%'")
        if args.only != 'lines':
            cur.execute("DELETE FROM solara.substation WHERE id LIKE 'osm:%'")
        cur.executemany(
            """
            INSERT INTO solara.line (id, name, voltage_kv, circuits, operator, source, geom)
            VALUES (%s, %s, %s, %s, %s, 'OpenStreetMap', ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
            """, lines)
        cur.executemany(
            """
            INSERT INTO solara.substation (id, name, voltage_kv, operator, source, geom)
            VALUES (%s, %s, %s, %s, 'OpenStreetMap', ST_SetSRID(ST_MakePoint(%s, %s), 4326))
            """, subs)
        if args.with_plants:
            cur.execute("DELETE FROM solara.plant WHERE id LIKE 'osm:%'")
            cur.executemany(
                """
                INSERT INTO solara.plant (id, name, fueltype, technology, capacity_mw,
                                          year_commissioned, operator, source, geom)
                VALUES (%s, %s, %s, %s, %s, %s, %s, 'OpenStreetMap',
                        ST_SetSRID(ST_MakePoint(%s, %s), 4326))
                """, plant_rows)
        credit(cur, 'OpenStreetMap contributors (ODbL)')
    print(f'{len(lines):,} lines and {len(subs):,} substations loaded'
          + (f', {len(plant_rows):,} plants' if args.with_plants else ''))


# ---- check --------------------------------------------------------------------------


def check(args) -> None:
    with connect(args.dsn) as conn:
        report = contract.describe(conn)
    print(f'profile: {report["profile"]}   name: {report["name"]}   contract: v{report["contract_version"]}')
    for e in report['entities']:
        state = f'{e["rows"]:>9,} rows' if e['present'] else '   absent'
        print(f'  {e["table"]:<20} {state}')
        for p in e['problems']:
            print(f'      ! {p}')
    for p in report['problems']:
        print(f'  ! {p}')
    print('can do: ' + (', '.join(k for k, v in report['capabilities'].items() if v) or 'nothing'))
    if report['problems'] or any(e['problems'] for e in report['entities']):
        raise SystemExit(1)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='command', required=True)

    def command(name, fn):
        p = sub.add_parser(name)
        p.add_argument('--dsn', required=True, help='postgresql://... or postgresql:///database')
        p.set_defaults(fn=fn)
        return p

    p = command('init', init)
    p.add_argument('--name', required=True, help='what the Grid store card calls this store')
    p.add_argument('--sources')
    p.add_argument('--notes')

    p = command('plants', plants)
    p.add_argument('--csv', required=True)
    p.add_argument('--format', choices=sorted(PLANT_FORMATS), required=True)
    p.add_argument('--country', help="keep only rows of this country, as the file writes it ('ITA', 'Italy')")
    p.add_argument('--source', help='what to credit; defaults to the format name')
    p.add_argument('--replace', action='store_true', help='drop what this format loaded before')

    p = command('boundaries', boundaries)
    p.add_argument('--geojson', required=True)
    p.add_argument('--level', type=int, required=True)
    p.add_argument('--level-name', required=True)
    p.add_argument('--id-field', required=True)
    p.add_argument('--name-field', required=True)
    p.add_argument('--parent-field', help="the property holding the id of the level above")
    p.add_argument('--source')

    p = command('boundaries-world', boundaries_world)
    p.add_argument('--country', required=True, help='ISO 3166-1 alpha-3: ITA, PRT, CHL')
    p.add_argument('--levels', help='which levels, as 1,2; all of them when omitted')

    p = command('osm', osm)
    p.add_argument('--country', required=True, help='ISO 3166-1 alpha-2: IT, PT, CL')
    p.add_argument('--min-kv', type=float, default=0.0)
    p.add_argument('--with-plants', action='store_true')
    p.add_argument('--only', choices=('lines', 'substations'), help='reload one of the two and leave the other')
    p.add_argument('--timeout', type=int, default=600)

    command('check', check)

    args = ap.parse_args()
    args.fn(args)


if __name__ == '__main__':
    main()
