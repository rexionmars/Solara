"""Read vector GeoPackages without modifying the source database."""
from __future__ import annotations

from contextlib import contextmanager
import json
import math
from pathlib import Path
import sqlite3
import time
from xml.etree import ElementTree

from . import protocol


def quoted(name):
    return '"' + name.replace('"', '""') + '"'


@contextmanager
def database(path):
    p = Path(path).resolve()
    if p.suffix.lower() != '.gpkg' or not p.is_file():
        raise ValueError('Choose an existing .gpkg file.')
    conn = sqlite3.connect(p.as_uri() + '?mode=ro', uri=True)
    conn.row_factory = sqlite3.Row
    deadline = time.monotonic() + 20
    conn.set_progress_handler(lambda: int(time.monotonic() > deadline), 10000)
    try:
        if conn.execute('pragma application_id').fetchone()[0] != 0x47504B47:
            raise ValueError('This file is not a GeoPackage.')
        yield conn
    finally:
        conn.close()


def layers(conn):
    return conn.execute('''
        select c.table_name, c.identifier, c.min_x, c.min_y, c.max_x, c.max_y,
               g.column_name, g.geometry_type_name, g.srs_id
        from gpkg_contents c join gpkg_geometry_columns g using (table_name)
        where c.data_type = 'features' order by c.table_name
    ''').fetchall()


def projection(conn, layer):
    from pyproj import CRS, Transformer
    row = conn.execute('select * from gpkg_spatial_ref_sys where srs_id = ?',
                       (layer['srs_id'],)).fetchone()
    if row is None:
        raise ValueError('The layer has no coordinate reference system.')
    if row['organization'].upper() == 'EPSG' and row['organization_coordsys_id'] > 0:
        crs = CRS.from_epsg(row['organization_coordsys_id'])
    else:
        crs = CRS.from_wkt(row['definition'])
    return (Transformer.from_crs(crs, 4326, always_xy=True),
            Transformer.from_crs(4326, crs, always_xy=True))


def inspect(path):
    with database(path) as conn:
        out = []
        for layer in layers(conn):
            bbox, error = None, None
            try:
                forward, _ = projection(conn, layer)
                values = [layer[k] for k in ('min_x', 'min_y', 'max_x', 'max_y')]
                if all(v is not None for v in values):
                    bounds = forward.transform_bounds(*values)
                    if all(math.isfinite(v) for v in bounds):
                        bbox = bounds
            except Exception as exc:
                error = f'Unsupported coordinate system: {exc}'
            table = quoted(layer['table_name'])
            count = conn.execute(f'select count(*) from {table}').fetchone()[0]
            out.append(dict(name=layer['table_name'], label=layer['identifier'] or layer['table_name'],
                            geometry=layer['geometry_type_name'], count=count, bbox=bbox, error=error,
                            style=layer_style(conn, layer['table_name'])))
        if not out:
            raise ValueError('This GeoPackage has no vector layers. Raster tiles are not supported.')
        return dict(path=str(Path(path).resolve()), name=Path(path).name, layers=out)


def layer_style(conn, name):
    """Read common QGIS single-symbol and categorized QML stored in layer_styles."""
    if not conn.execute("select 1 from sqlite_master where type='table' and name='layer_styles'").fetchone():
        return {}
    columns = {r['name'] for r in conn.execute('pragma table_info(layer_styles)')}
    if not {'f_table_name', 'styleQML'} <= columns:
        return {}
    order = ' order by useAsDefault desc' if 'useAsDefault' in columns else ''
    row = conn.execute('select substr(styleQML,1,2000000) from layer_styles where f_table_name=?' + order + ' limit 1', (name,)).fetchone()
    if not row or not row[0]:
        return {}
    try:
        root = ElementTree.fromstring(row[0])
    except (ElementTree.ParseError, ValueError):
        return {}
    renderer = root.find('.//renderer-v2')
    if renderer is None:
        return {}

    def color(symbol):
        properties = {p.get('k', p.get('name')): p.get('v', p.get('value'))
                      for p in symbol.iter() if p.tag in ('prop', 'Option')}
        keys = ('line_color', 'color', 'outline_color') if symbol.get('type') == 'line' else ('color', 'line_color', 'outline_color')
        return next((properties[k] for k in keys if properties.get(k)), None)

    symbols = {s.get('name'): color(s) for s in renderer.findall('./symbols/symbol')}
    if renderer.get('type') == 'singleSymbol':
        chosen = next((c for c in symbols.values() if c), None)
        return {'color': chosen} if chosen else {}
    if renderer.get('type') == 'categorizedSymbol' and renderer.get('attr'):
        categories = {c.get('value', ''): symbols[c.get('symbol')] for c in renderer.findall('./categories/category')
                      if symbols.get(c.get('symbol'))}
        return {'field': renderer.get('attr'), 'categories': categories}
    return {}


def read_features(path, name, bbox):
    from shapely import from_wkb
    from shapely.geometry import box, mapping
    from shapely.ops import transform
    if not isinstance(bbox, (list, tuple)) or len(bbox) != 4 or not all(
            isinstance(v, (float, int)) and math.isfinite(v) for v in bbox):
        raise ValueError('A finite map extent is required.')
    if not (-180 <= bbox[0] < bbox[2] <= 180 and -90 <= bbox[1] < bbox[3] <= 90):
        raise ValueError('Invalid map extent.')
    with database(path) as conn:
        layer = next((r for r in layers(conn) if r['table_name'] == name), None)
        if layer is None:
            raise ValueError('The selected vector layer does not exist.')
        forward, reverse = projection(conn, layer)
        table, geom = quoted(name), quoted(layer['column_name'])
        pk = next((r['name'] for r in conn.execute(f'pragma table_info({table})') if r['pk']), None)
        rtree_name = f'rtree_{name}_{layer["column_name"]}'
        indexed = pk and conn.execute('select 1 from sqlite_master where type = ? and name = ?',
                                      ('table', rtree_name)).fetchone() is not None
        sql, params = f'select t.* from {table} t', []
        if indexed:
            west, south, east, north = reverse.transform_bounds(*bbox)
            sql += (f' join {quoted(rtree_name)} r on t.{quoted(pk)} = r.id'
                    ' where r.maxx >= ? and r.minx <= ? and r.maxy >= ? and r.miny <= ?')
            params = [west, east, south, north]
        sql += ' limit 50001'
        features, skipped, scanned, size, limited = [], 0, 0, 0, False
        view = box(*bbox)
        for row in conn.execute(sql, params):
            scanned += 1
            if scanned > 50000 or len(features) >= 5000:
                limited = True
                break
            blob = row[layer['column_name']]
            try:
                if blob is None:
                    continue
                if len(blob) > 8_000_000:
                    skipped += 1
                    continue
                if blob[:2] != b'GP' or len(blob) < 8 or blob[3] & 0x20:
                    raise ValueError('Unsupported GeoPackage geometry')
                envelope = (blob[3] >> 1) & 7
                if envelope > 4:
                    raise ValueError('Invalid geometry envelope')
                offset = 8 + [0, 32, 48, 48, 64][envelope]
                shape = from_wkb(blob[offset:])
                if shape.is_empty:
                    continue
                shape = transform(forward.transform, shape)
                if not shape.intersects(view):
                    continue
                # Clip before simplifying so continent-scale lines do not cross the bridge whole.
                shape = shape.intersection(view).simplify(max(bbox[2]-bbox[0], bbox[3]-bbox[1]) / 2000,
                                                         preserve_topology=True)
                props = {k: (v[:4000] if isinstance(v, str) else v)
                         for k in row.keys() if k != layer['column_name']
                         and not isinstance((v := row[k]), bytes)}
                feature = dict(type='Feature', geometry=mapping(shape), properties=props)
                encoded = json.dumps(feature, allow_nan=False)
                if size + len(encoded.encode('utf-8')) > 6_000_000:
                    limited = True
                    break
                size += len(encoded.encode('utf-8'))
                features.append(feature)
            except Exception:
                # A bad feature must not prevent inspection of the rest of a layer.
                skipped += 1
        return dict(geojson=dict(type='FeatureCollection', features=features),
                    limited=limited, skipped=skipped, indexed=bool(indexed))


def action(req):
    try:
        if req['action'] == 'gpkg_inspect':
            result = inspect(req['path'])
        else:
            result = read_features(req['path'], req['layer'], req['bbox'])
        protocol.reply(result)
    except Exception as exc:
        raise protocol.Unavailable(f'Could not read GeoPackage: {exc}') from exc
