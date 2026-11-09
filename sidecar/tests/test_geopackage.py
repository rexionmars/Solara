"""Exercise real GeoPackage blobs, spatial filtering, reprojection and read-only access."""
import hashlib
import json
import sqlite3
import struct

import pytest
from pyproj import Transformer
from shapely.geometry import Point

from terra_energy_engine.geopackage import database, inspect, profile, read_feature, read_features


@pytest.fixture
def package(tmp_path):
    def create(srs=4326, indexed=True):
        path = tmp_path / f'features-{srs}-{indexed}.gpkg'
        conn = sqlite3.connect(path)
        conn.executescript('''
            pragma application_id = 1196444487;
            create table gpkg_contents (table_name text, identifier text, data_type text,
                min_x real, min_y real, max_x real, max_y real);
            create table gpkg_geometry_columns (table_name text, column_name text,
                geometry_type_name text, srs_id integer);
            create table gpkg_spatial_ref_sys (srs_id integer, organization text,
                organization_coordsys_id integer, definition text);
            create table assets (fid integer primary key, geom blob, name text);
        ''')
        conn.execute('insert into gpkg_spatial_ref_sys values (?, ?, ?, ?)', (srs, 'EPSG', srs, ''))
        conn.execute("insert into gpkg_geometry_columns values ('assets', 'geom', 'POINT', ?)", (srs,))
        transformer = Transformer.from_crs(4326, srs, always_xy=True)
        coords = [transformer.transform(-38, -4), transformer.transform(-40, -6)]
        conn.execute("insert into gpkg_contents values ('assets', 'Assets', 'features', ?, ?, ?, ?)",
                     (*coords[1], *coords[0]))
        if indexed:
            conn.execute('create virtual table rtree_assets_geom using rtree(id,minx,maxx,miny,maxy)')
        for fid, (x, y) in enumerate(coords, 1):
            blob = b'GP\x00\x01' + struct.pack('<i', srs) + Point(x, y).wkb
            conn.execute('insert into assets values (?, ?, ?)', (fid, blob, f'Asset {fid}'))
            if indexed:
                conn.execute('insert into rtree_assets_geom values (?, ?, ?, ?, ?)', (fid, x, x, y, y))
        conn.commit()
        conn.close()
        return path
    return create


@pytest.mark.parametrize('srs', [4326, 3857])
@pytest.mark.parametrize('indexed', [True, False])
def test_preview_reprojects_filters_and_keeps_source_unchanged(package, srs, indexed):
    path = package(srs, indexed)
    before = hashlib.sha256(path.read_bytes()).digest()
    catalog = inspect(path)
    assert catalog['layers'][0]['count'] == 2
    assert catalog['layers'][0]['bbox'] == pytest.approx([-40, -6, -38, -4])
    result = read_features(path, 'assets', [-39, -5, -37, -3])
    assert result['indexed'] is indexed
    assert result['skipped'] == 0
    assert len(result['geojson']['features']) == 1
    feature = result['geojson']['features'][0]
    assert feature['geometry']['coordinates'] == pytest.approx([-38, -4])
    assert feature['properties']['name'] == 'Asset 1'
    assert hashlib.sha256(path.read_bytes()).digest() == before
    with database(path) as conn, pytest.raises(sqlite3.OperationalError, match='readonly'):
        conn.execute('delete from assets')


def test_unknown_layer_and_invalid_extent_are_rejected(package):
    path = package()
    with pytest.raises(ValueError, match='does not exist'):
        read_features(path, 'assets"; drop table assets; --', [-39, -5, -37, -3])
    with pytest.raises(ValueError, match='extent'):
        read_features(path, 'assets', [float('nan'), 0, 1, 1])


def test_feature_limit_is_reported(package):
    path = package(indexed=False)
    with sqlite3.connect(path) as conn:
        blob = conn.execute('select geom from assets where fid=1').fetchone()[0]
        conn.executemany('insert into assets (geom,name) values (?,?)', [(blob, 'Extra')] * 5001)
    result = read_features(path, 'assets', [-39, -5, -37, -3])
    assert len(result['geojson']['features']) == 5000
    assert result['limited']


def test_corrupt_geometry_is_reported(package):
    path = package(indexed=False)
    with sqlite3.connect(path) as conn:
        conn.execute("update assets set geom=x'00010203' where fid=1")
    result = read_features(path, 'assets', [-39, -5, -37, -3])
    assert result['skipped'] == 1
    assert not result['geojson']['features']








def test_qgis_layer_colors_are_preserved_and_invalid_styles_are_ignored(package):
    path = package()
    with sqlite3.connect(path) as conn:
        conn.execute('create table layer_styles (f_table_name text, styleQML text, useAsDefault integer)')
        conn.execute('insert into layer_styles values (?,?,1)', ('assets', '''<qgis><renderer-v2 type="singleSymbol"><symbols>
            <symbol name="0" type="marker"><layer><Option><Option name="color" value="255,128,0,255"/></Option></layer></symbol>
            </symbols></renderer-v2></qgis>'''))
    assert inspect(path)['layers'][0]['style']['color'] == '255,128,0,255'
    with sqlite3.connect(path) as conn:
        conn.execute('update layer_styles set styleQML=?', ('''<qgis><renderer-v2 type="categorizedSymbol" attr="kind">
            <categories><category value="wind" symbol="0"/><category value="solar" symbol="1"/></categories>
            <symbols><symbol name="0"><layer><prop k="color" v="0,128,255,255"/></layer></symbol>
            <symbol name="1"><layer><prop k="color" v="255,200,0,255"/></layer></symbol></symbols>
            </renderer-v2></qgis>''',))
    style = inspect(path)['layers'][0]['style']
    assert style['field'] == 'kind'
    assert style['categories']['wind'] == '0,128,255,255'
    with sqlite3.connect(path) as conn:
        conn.execute("update layer_styles set styleQML='invalid XML'")
    assert inspect(path)['layers'][0]['style'] == {}


def test_catalog_declares_each_attribute_type_and_the_primary_key(package):
    path = package()
    with sqlite3.connect(path) as conn:
        for column in ('active BOOLEAN', 'opened DATE', 'seen DATETIME', 'code MEDIUMINT',
                       'load DOUBLE', 'note TEXT(20)', 'photo BLOB', 'odd WHATEVER'):
            conn.execute(f'alter table assets add column {column}')
        conn.execute('create table gpkg_data_columns (table_name text, column_name text, name text, title text)')
        conn.execute("insert into gpkg_data_columns values ('assets', 'load', 'load', 'Peak load (MW)')")
    layer = inspect(path)['layers'][0]
    assert layer['pk'] == 'fid'
    assert [(f['name'], f['type']) for f in layer['fields']] == [
        ('fid', 'integer'), ('name', 'text'), ('active', 'boolean'), ('opened', 'date'), ('seen', 'datetime'),
        ('code', 'integer'), ('load', 'real'), ('note', 'text'), ('photo', 'blob'), ('odd', 'text')]
    assert next(f for f in layer['fields'] if f['name'] == 'load')['title'] == 'Peak load (MW)'
    assert 'title' not in layer['fields'][0]


def test_preview_carries_only_the_attributes_the_map_draws_with(package):
    path = package()
    with sqlite3.connect(path) as conn:
        conn.execute('alter table assets add column kind text')
        conn.execute("update assets set kind = 'wind'")
    feature = read_features(path, 'assets', [-39, -5, -37, -3], ['kind'])['geojson']['features'][0]
    assert feature['properties'] == {'fid': 1, 'kind': 'wind'}
    with pytest.raises(ValueError, match='list of strings'):
        read_features(path, 'assets', [-39, -5, -37, -3], 'kind')


def test_a_non_finite_attribute_does_not_drop_its_feature(package):
    path = package()
    with sqlite3.connect(path) as conn:
        conn.execute('alter table assets add column load real')
        conn.execute('update assets set load = 9e999')
    result = read_features(path, 'assets', [-39, -5, -37, -3])
    assert result['skipped'] == 0
    assert result['geojson']['features'][0]['properties']['load'] == 'Infinity'


@pytest.mark.parametrize('srs', [4326, 3857])
def test_a_clicked_feature_is_read_whole(package, srs):
    path = package(srs)
    with sqlite3.connect(path) as conn:
        conn.execute('alter table assets add column tags text')
        conn.execute('alter table assets add column photo blob')
        conn.execute('update assets set tags = ?, photo = ? where fid = 2', ('x' * 9000, b'\x00' * 300))
    feature = read_feature(path, 'assets', 2)
    assert feature['id'] == 2
    assert feature['geometry_error'] is None
    assert feature['geometry']['coordinates'] == pytest.approx([-40, -6])
    assert len(feature['properties']['tags']) == 9000
    assert feature['properties']['photo'] == 300
    json.dumps(feature, allow_nan=False)
    with pytest.raises(ValueError, match='does not exist'):
        read_feature(path, 'assets', 99)
    with pytest.raises(ValueError, match='feature id'):
        read_feature(path, 'assets', True)


def test_a_clicked_feature_keeps_its_attributes_when_its_geometry_is_unreadable(package):
    path = package()
    with sqlite3.connect(path) as conn:
        conn.execute("update assets set geom = x'00010203' where fid = 1")
    feature = read_feature(path, 'assets', 1)
    assert feature['geometry'] is None
    assert 'Unsupported' in feature['geometry_error']
    assert feature['properties']['name'] == 'Asset 1'


def crowd(path, srs, points):
    """Add points to the fixture's layer and its spatial index."""
    transformer = Transformer.from_crs(4326, srs, always_xy=True)
    with sqlite3.connect(path) as conn:
        start = conn.execute('select max(fid) from assets').fetchone()[0] + 1
        for fid, (lon, lat) in enumerate(points, start):
            x, y = transformer.transform(lon, lat)
            conn.execute('insert into assets values (?, ?, ?)', (fid, b'GP\x00\x01' + struct.pack('<i', srs) + Point(x, y).wkb, 'Crowd'))
            conn.execute('insert into rtree_assets_geom values (?, ?, ?, ?, ?)', (fid, x, x, y, y))


@pytest.mark.parametrize('srs', [4326, 3857])
def test_a_crowded_view_is_counted_per_cell_rather_than_cut(package, srs):
    path = package(srs)
    # Two clusters far apart: the first 5,000 rows would all be the western one.
    crowd(path, srs, [(-39.0 + i * 1e-5, -5.0) for i in range(4000)] + [(-37.5, -3.5 + i * 1e-5) for i in range(1500)])
    result = read_features(path, 'assets', [-41, -7, -36, -2], [], 6.0)
    assert result['geojson']['features'] == []
    assert result['in_view'] == 5502
    cells = result['cells']
    assert cells['zoom'] == 10
    assert sum(c[2] for c in cells['items']) == 5502
    biggest = sorted(cells['items'], key=lambda c: c[2])[-2:]
    assert [c[2] for c in biggest] == [1500, 4000]
    assert biggest[1][3:] == pytest.approx([-38.98, -5.0], abs=0.01)
    assert biggest[0][3:] == pytest.approx([-37.5, -3.49], abs=0.01)


def test_counting_needs_the_zoom_and_a_crowd(package):
    path = package()
    assert 'cells' not in read_features(path, 'assets', [-41, -7, -36, -2], [], 6.0)
    crowd(path, 4326, [(-39.0, -5.0)] * 5000)
    without_zoom = read_features(path, 'assets', [-41, -7, -36, -2], [])
    assert 'cells' not in without_zoom and without_zoom['limited']
    with pytest.raises(ValueError, match='zoom'):
        read_features(path, 'assets', [-41, -7, -36, -2], [], 30)


def test_a_generic_layer_is_catalogued_by_the_kinds_its_features_hold(package):
    path = package()
    assert inspect(path)['layers'][0]['kinds'] is None
    with sqlite3.connect(path) as conn:
        conn.execute("update gpkg_geometry_columns set geometry_type_name = 'GEOMETRY'")
        square = Point(-39, -5).buffer(0.1)
        conn.execute('insert into assets (geom, name) values (?, ?)', (b'GP\x00\x01' + struct.pack('<i', 4326) + square.wkb, 'Area'))
        conn.execute('insert into assets (geom, name) values (null, ?)', ('Nowhere',))
    layer = inspect(path)['layers'][0]
    assert layer['geometry'] == 'GEOMETRY'
    assert layer['kinds'] == [{'kind': 'Point', 'count': 2}, {'kind': 'Null', 'count': 1}, {'kind': 'Polygon', 'count': 1}]


def test_a_profile_reads_what_each_attribute_holds(package):
    path = package()
    with sqlite3.connect(path) as conn:
        for column in ('osm_id text', 'kind text', 'voltage_kv real', 'pressure text', 'line text', 'tags text', 'photo blob'):
            conn.execute(f'alter table assets add column {column}')
        blob = conn.execute('select geom from assets where fid = 1').fetchone()[0]
        conn.executemany('insert into assets (geom, name) values (?, ?)', [(blob, f'Extra {i}') for i in range(38)])
        conn.execute("update assets set osm_id = 'node/' || fid, line = 'substation', pressure = '', "
                     "kind = case when fid % 3 = 0 then 'transmission' else 'distribution' end, "
                     "voltage_kv = case when fid % 4 = 0 then null else fid * 10.0 end, "
                     "tags = json_object('power', 'substation', 'name', name) || '', photo = x'0001'")
        conn.execute("update assets set voltage_kv = '138 kV' where fid = 5")
        conn.execute("update assets set tags = json_object('power', 'substation', 'operator', 'Copel') where fid = 7")
    p = profile(path, 'assets')
    assert p['count'] == 40 and p['pk'] == 'fid'
    assert p['geometry'] == {'declared': 'POINT', 'kinds': [{'kind': 'Point', 'count': 40}]}
    assert p['incomplete'] == []
    f = {c['name']: c for c in p['fields']}
    assert 'fid' not in f
    assert f['osm_id']['role'] == 'identifier' and f['osm_id']['distinct'] == 40 and 'top' not in f['osm_id']
    assert f['pressure']['role'] == 'empty' and f['pressure']['filled'] == 0
    assert f['line']['role'] == 'constant' and f['line']['top'] == [{'value': 'substation', 'count': 40}]
    assert f['kind']['role'] == 'category'
    assert f['kind']['top'] == [{'value': 'distribution', 'count': 27}, {'value': 'transmission', 'count': 13}]
    assert f['voltage_kv']['role'] == 'number' and f['voltage_kv']['filled'] == 30
    assert f['voltage_kv']['mismatched'] == 1
    assert f['voltage_kv']['range']['min'] == 10.0 and f['voltage_kv']['range']['max'] == 390.0
    # 29 numbers, 10 to 390 without the multiples of 40 and fid 5: the 15th is 210.
    assert f['voltage_kv']['range']['median'] == 210.0
    assert sum(f['voltage_kv']['histogram']) == 29
    assert f['tags']['role'] == 'json' and f['tags']['key_count'] == 3
    assert f['tags']['keys'] == [{'value': 'power', 'count': 40}, {'value': 'name', 'count': 39}, {'value': 'operator', 'count': 1}]
    assert f['photo']['role'] == 'binary'
    json.dumps(p, allow_nan=False)


def test_a_profile_names_what_the_time_did_not_allow(package, monkeypatch):
    import terra_energy_engine.geopackage as gpkg
    path = package()
    monkeypatch.setattr(gpkg, 'PROFILE_SPARE_S', gpkg.PROFILE_SECONDS + 1)
    p = profile(path, 'assets')
    assert p['geometry']['kinds'] is None
    assert p['incomplete'] == ['geom', 'name']
    assert 'role' not in p['fields'][0] and p['fields'][0]['filled'] == 2
