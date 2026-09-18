"""
The GFS wind field: how a THREDDS subset becomes the grid the interface draws,
and when the network is not asked at all.
"""

from __future__ import annotations

import datetime as dt
import io
import json

import numpy as np
import pytest

from terra_energy_engine import protocol, registry
from terra_energy_engine.weather import actions, wind


def subset(lat, lon, u, v, valid_h=183.0, run_h=174.0) -> bytes:
    """A NetCDF 3 file shaped as THREDDS writes one: time, height, lat, lon."""
    from scipy.io import netcdf_file

    buf = io.BytesIO()
    f = netcdf_file(buf, 'w')
    f.createDimension('time', 1)
    f.createDimension('reftime', 1)
    f.createDimension('height_above_ground2', 1)
    f.createDimension('latitude', len(lat))
    f.createDimension('longitude', len(lon))
    for name, value in (('time', valid_h), ('reftime', run_h)):
        var = f.createVariable(name, 'd', (name,))
        var[:] = [value]
        var.units = b'Hour since 2026-09-10T00:00:00Z'
    la = f.createVariable('latitude', 'f', ('latitude',))
    la[:] = lat
    lo = f.createVariable('longitude', 'f', ('longitude',))
    lo[:] = lon
    for name, data in ((wind.U, u), (wind.V, v)):
        var = f.createVariable(name, 'f', ('time', 'height_above_ground2', 'latitude', 'longitude'))
        var[:] = np.asarray(data, dtype='f4').reshape(1, 1, len(lat), len(lon))
    f.flush()
    content = buf.getvalue()
    f.close()
    return content


def test_the_registry_routes_the_wind_field():
    assert registry.resolve('wind_field') is actions.wind_field


def test_a_subset_becomes_a_grid_west_to_east_and_north_to_south():
    # Latitudes north to south and longitudes 0..360, as THREDDS returns them.
    lat = [10.0, 9.5]
    lon = [300.0, 300.5, 301.0]
    u = [[1, 2, 3], [4, 5, 6]]
    v = [[-1, -2, -3], [-4, -5, -6]]
    field = wind.parse(subset(lat, lon, u, v), 10)
    assert (field['lon0'], field['lat0'], field['dlon'], field['dlat']) == (-60.0, 10.0, 0.5, 0.5)
    assert (field['nx'], field['ny']) == (3, 2)
    assert field['u'] == [1, 2, 3, 4, 5, 6]
    assert field['valid'] == '2026-09-17T15:00:00Z'
    assert field['run'] == '2026-09-17T06:00:00Z'


def test_a_grid_given_south_to_north_is_turned_the_right_way():
    field = wind.parse(subset([9.5, 10.0], [300.0, 300.5], [[1, 2], [3, 4]], [[0, 0], [0, 0]]), 100)
    assert field['lat0'] == 10.0
    assert field['u'] == [3, 4, 1, 2]
    assert field['height_m'] == 100


def test_a_value_the_model_does_not_have_is_null_and_not_a_number():
    field = wind.parse(subset([10.0, 9.5], [300.0, 300.5], [[np.nan, 2], [3, 1e20]], [[0, 0], [0, 0]]), 10)
    assert field['u'] == [None, 2, 3, None]
    json.dumps(field, allow_nan=False)


def test_the_subset_asks_for_one_height_and_the_hour():
    url = wind.subset_url(100, dt.datetime(2026, 9, 17, 14, 0, tzinfo=dt.UTC))
    assert 'vertCoord=100' in url and 'time=2026-09-17T14%3A00%3A00Z' in url and 'accept=netcdf3' in url


def test_a_field_cached_this_hour_is_read_without_the_network(tmp_path, monkeypatch):
    now = dt.datetime(2026, 9, 17, 14, 28, tzinfo=dt.UTC)
    (tmp_path / 'gfs-wind-10m-20260917T14.nc').write_bytes(subset([10.0, 9.5], [300.0, 300.5], [[1, 2], [3, 4]], [[0, 0], [0, 0]]))

    def offline(*_a, **_k):
        raise AssertionError('the network was asked')

    monkeypatch.setattr(wind.urllib.request, 'urlopen', offline)
    assert wind.fetch(10, tmp_path, now)['u'] == [1, 2, 3, 4]


def test_an_unreachable_server_is_said_as_that(tmp_path, monkeypatch):
    def refused(*_a, **_k):
        raise wind.urllib.error.URLError('connection refused')

    monkeypatch.setattr(wind.urllib.request, 'urlopen', refused)
    with pytest.raises(protocol.Unavailable) as exc:
        wind.fetch(10, tmp_path)
    assert 'could not be reached' in str(exc.value)


def test_a_height_gfs_is_not_read_at_is_refused(capsys):
    with pytest.raises(SystemExit):
        actions.wind_field({'height_m': 50})
    assert 'height_m' in capsys.readouterr().err
