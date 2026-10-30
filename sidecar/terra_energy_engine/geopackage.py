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


# The column types the GeoPackage specification names exactly; anything else
# is read by SQLite's affinity rules, so INT, TEXT(20) and DOUBLE find a type.
EXACT_TYPES = {'BOOLEAN': 'boolean', 'DATE': 'date', 'DATETIME': 'datetime'}


def field_type(declared):
    t = (declared or '').upper()
    if t in EXACT_TYPES:
        return EXACT_TYPES[t]
    if 'INT' in t:
        return 'integer'
    if 'BLOB' in t:
        return 'blob'
    if any(k in t for k in ('REAL', 'FLOA', 'DOUB')):
        return 'real'
    return 'text'


def schema(conn, layer):
    """The layer's attribute columns in table order, and its primary key."""
    table = layer['table_name']
    titles = {}
    if conn.execute("select 1 from sqlite_master where type='table' and name='gpkg_data_columns'").fetchone():
        titles = {r['column_name']: r['title'] or r['name'] for r in conn.execute(
            'select column_name, name, title from gpkg_data_columns where table_name = ?', (table,))}
    fields, pk = [], None
    for r in conn.execute(f'pragma table_info({quoted(table)})'):
        if r['pk'] and pk is None:
            pk = r['name']
        if r['name'] == layer['column_name']:
            continue
        field = dict(name=r['name'], type=field_type(r['type']))
        if titles.get(r['name']) and titles[r['name']] != r['name']:
            field['title'] = titles[r['name']]
        fields.append(field)
    return fields, pk


def attribute(value):
    """A column value as JSON can carry it: a blob by its size, a non-finite real by name."""
    if isinstance(value, bytes):
        return len(value)
    if isinstance(value, float) and not math.isfinite(value):
        return 'NaN' if math.isnan(value) else 'Infinity' if value > 0 else '-Infinity'
    return value


def decode(blob):
    """The geometry of a GeoPackage binary; ValueError for one this reader does not take."""
    from shapely import from_wkb
    if blob[:2] != b'GP' or len(blob) < 8 or blob[3] & 0x20:
        raise ValueError('Unsupported GeoPackage geometry')
    envelope = (blob[3] >> 1) & 7
    if envelope > 4:
        raise ValueError('Invalid geometry envelope')
    return from_wkb(blob[8 + [0, 32, 48, 48, 64][envelope]:])


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


def layer_named(conn, name):
    layer = next((r for r in layers(conn) if r['table_name'] == name), None)
    if layer is None:
        raise ValueError('The selected vector layer does not exist.')
    return layer


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
            fields, pk = schema(conn, layer)
            out.append(dict(name=layer['table_name'], label=layer['identifier'] or layer['table_name'],
                            geometry=layer['geometry_type_name'], count=count, bbox=bbox, error=error,
                            style=layer_style(conn, layer['table_name']), fields=fields, pk=pk))
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


# Features drawn one by one in a view; past this a preview counts them per cell.
LIMIT = 5000


def mercator(lon, lat):
    """Web Mercator in the unit square, x east and y south, for arrays or numbers."""
    import numpy as np
    sin = np.sin(np.radians(np.clip(lat, -85.0511, 85.0511)))
    return (np.asarray(lon) + 180) / 360, 0.5 - np.log((1 + sin) / (1 - sin)) / (4 * math.pi)


def count_cells(conn, rtree, bounds, forward, bbox, zoom):
    """How many features each Web Mercator cell holds, read from the spatial index alone.

    The cells are the tiles of zoom round(zoom) + 4, so 22 to 45 px on screen
    and fixed to the ground: panning moves them with the map instead of
    regrouping. Each is placed at the mean of its features' envelope centres,
    which keeps a cell of towers on its line rather than at the cell's middle.

    SQLite first sums the envelope centres over a grid four times finer than
    the cells, in the layer's own coordinates, so Python handles thousands of
    rows rather than every feature; each fine bin then joins the cell its mean
    falls in. A feature within a fine bin of a cell's edge can be counted in
    the neighbouring cell; the total is exact.
    Returns the cell zoom, [x, y, count, lon, lat] per cell, and the total.
    """
    import numpy as np
    west, south, east, north = bounds
    cz = min(int(math.floor(zoom + 0.5)) + 4, 28)
    n = 2 ** cz
    (x0, x1), (y0, y1) = mercator([bbox[0], bbox[2]], [bbox[3], bbox[1]])
    fx = min(512, math.ceil(4 * max(1.0, (x1 - x0) * n)))
    fy = min(512, math.ceil(4 * max(1.0, (y1 - y0) * n)))
    dx, dy = (east - west) / fx, (north - south) / fy
    rows = conn.execute(
        f'select count(*), sum(cx), sum(cy) from (select (minx + maxx) / 2 cx, (miny + maxy) / 2 cy '
        f'from {quoted(rtree)} where maxx >= ? and minx <= ? and maxy >= ? and miny <= ?) '
        'group by cast((cx - ?) / ? as int), cast((cy - ?) / ? as int)',
        (west, east, south, north, west, dx, south, dy)).fetchall()
    if not rows:
        return cz, [], 0
    bins = np.asarray(rows, dtype=float)
    count = bins[:, 0]
    lon, lat = (np.asarray(v, dtype=float) for v in forward.transform(bins[:, 1] / count, bins[:, 2] / count))
    keep = np.isfinite(lon) & np.isfinite(lat)
    count, lon, lat = count[keep], lon[keep], lat[keep]
    mx, my = mercator(lon, lat)
    ix = np.clip(np.floor(mx * n), 0, n - 1).astype(np.int64)
    iy = np.clip(np.floor(my * n), 0, n - 1).astype(np.int64)
    cells, inverse = np.unique(ix * n + iy, return_inverse=True)
    total = np.bincount(inverse, count)
    mean_lon = np.bincount(inverse, lon * count) / total
    mean_lat = np.bincount(inverse, lat * count) / total
    items = [[int(c // n), int(c % n), int(k), round(float(x), 6), round(float(y), 6)]
             for c, k, x, y in zip(cells, total, mean_lon, mean_lat)]
    return cz, items, int(count.sum())


def read_features(path, name, bbox, wanted=None, zoom=None):
    """A bounded preview of one layer in the map's extent.

    `wanted` names the attributes the map draws with; the rest are read when a
    feature is clicked (read_feature), so a preview does not carry them all.
    None sends every attribute but blobs, cut at 4,000 characters.

    Given the map's `zoom`, an indexed layer with more than LIMIT features in
    view is counted per cell (count_cells) instead of cut at the first LIMIT,
    which drew whichever rows came first and left the rest of the map empty.
    """
    from shapely.geometry import box, mapping
    from shapely.ops import transform
    if not isinstance(bbox, (list, tuple)) or len(bbox) != 4 or not all(
            isinstance(v, (float, int)) and math.isfinite(v) for v in bbox):
        raise ValueError('A finite map extent is required.')
    if not (-180 <= bbox[0] < bbox[2] <= 180 and -90 <= bbox[1] < bbox[3] <= 90):
        raise ValueError('Invalid map extent.')
    if wanted is not None and not (isinstance(wanted, list) and all(isinstance(k, str) for k in wanted)):
        raise ValueError('Attribute names must be a list of strings.')
    if zoom is not None and not (isinstance(zoom, (int, float)) and not isinstance(zoom, bool) and 0 <= zoom <= 24):
        raise ValueError('The map zoom must be between 0 and 24.')
    with database(path) as conn:
        layer = layer_named(conn, name)
        forward, reverse = projection(conn, layer)
        table = quoted(name)
        _, pk = schema(conn, layer)
        keep = None if wanted is None else {*wanted, pk}
        rtree_name = f'rtree_{name}_{layer["column_name"]}'
        indexed = pk and conn.execute('select 1 from sqlite_master where type = ? and name = ?',
                                      ('table', rtree_name)).fetchone() is not None
        sql, params = f'select t.* from {table} t', []
        if indexed:
            west, south, east, north = reverse.transform_bounds(*bbox)
            sql += (f' join {quoted(rtree_name)} r on t.{quoted(pk)} = r.id'
                    ' where r.maxx >= ? and r.minx <= ? and r.maxy >= ? and r.miny <= ?')
            params = [west, east, south, north]
            window = ' where maxx >= ? and minx <= ? and maxy >= ? and miny <= ?'
            over = conn.execute(f'select count(*) from (select 1 from {quoted(rtree_name)}{window} limit {LIMIT + 1})',
                                params).fetchone()[0] > LIMIT
            if over and zoom is not None:
                cz, items, total = count_cells(conn, rtree_name, (west, south, east, north), forward, bbox, zoom)
                return dict(geojson=dict(type='FeatureCollection', features=[]), cells=dict(zoom=cz, items=items),
                            in_view=total, limited=False, skipped=0, indexed=True)
        sql += ' limit 50001'
        features, skipped, scanned, size, limited = [], 0, 0, 0, False
        view = box(*bbox)
        for row in conn.execute(sql, params):
            scanned += 1
            if scanned > 50000 or len(features) >= LIMIT:
                limited = True
                break
            blob = row[layer['column_name']]
            try:
                if blob is None:
                    continue
                if len(blob) > 8_000_000:
                    skipped += 1
                    continue
                shape = decode(blob)
                if shape.is_empty:
                    continue
                shape = transform(forward.transform, shape)
                if not shape.intersects(view):
                    continue
                # Clip before simplifying so continent-scale lines do not cross the bridge whole.
                shape = shape.intersection(view).simplify(max(bbox[2]-bbox[0], bbox[3]-bbox[1]) / 2000,
                                                         preserve_topology=True)
                props = {k: (v[:4000] if isinstance(v, str) else attribute(v))
                         for k in row.keys() if k != layer['column_name'] and (keep is None or k in keep)
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


def read_feature(path, name, fid):
    """One feature whole: every attribute uncut, and the geometry neither clipped nor simplified."""
    from shapely.geometry import mapping
    from shapely.ops import transform
    if not isinstance(fid, int) or isinstance(fid, bool):
        raise ValueError('A feature id is required.')
    with database(path) as conn:
        layer = layer_named(conn, name)
        _, pk = schema(conn, layer)
        if pk is None:
            raise ValueError('The layer has no primary key, so one feature cannot be read alone.')
        row = conn.execute(f'select * from {quoted(name)} where {quoted(pk)} = ?', (fid,)).fetchone()
        if row is None:
            raise ValueError('The feature does not exist.')
        geometry, error = None, None
        blob = row[layer['column_name']]
        if blob is not None:
            try:
                forward, _ = projection(conn, layer)
                shape = decode(blob)
                if not shape.is_empty:
                    geometry = mapping(transform(forward.transform, shape))
            except Exception as exc:
                # The attributes are still worth reading when the geometry is not.
                error = str(exc)
        props = {k: attribute(row[k]) for k in row.keys() if k != layer['column_name']}
        return dict(type='Feature', id=fid, geometry=geometry, properties=props, geometry_error=error)


def action(req):
    try:
        if req['action'] == 'gpkg_inspect':
            result = inspect(req['path'])
        elif req['action'] == 'gpkg_feature':
            result = read_feature(req['path'], req['layer'], req['fid'])
        else:
            result = read_features(req['path'], req['layer'], req['bbox'], req.get('fields'), req.get('zoom'))
        protocol.reply(result)
    except Exception as exc:
        raise protocol.Unavailable(f'Could not read GeoPackage: {exc}') from exc
