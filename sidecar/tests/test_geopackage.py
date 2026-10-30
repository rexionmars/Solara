"""Exercise real GeoPackage blobs, spatial filtering, reprojection and read-only access."""
import hashlib
import json
import sqlite3
import struct

import pytest
from pyproj import Transformer
from shapely.geometry import Point

from terra_energy_engine.geopackage import database, inspect, read_feature, read_features


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
