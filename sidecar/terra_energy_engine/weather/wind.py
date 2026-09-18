"""
The wind over South America now, as NOAA's GFS model has it.

WHERE IT COMES FROM. GFS at 0.25 degrees, subset by UCAR's THREDDS server
(NetCDF Subset Service) to the region and the one height asked for, and
returned as NetCDF 3, which scipy reads: no GRIB decoder, no new dependency.
The subset is about 180 KB at half-degree spacing, which is what an animated
field over a continent needs; the full resolution would be four times that and
look the same at the zooms a whole continent is seen at.

MODELLED, AND A FORECAST. THREDDS's "Best" dataset stitches the newest run's
forecast hours onto the older runs', so the field for this hour is a forecast
issued a few hours ago. The reply carries both times -- the run it came from
and the hour it is valid for -- and the interface shows both.

A RESEARCH SERVICE. UCAR runs THREDDS for the community, with no availability
promise; a failure to reach it is reported as that and not as a broken
application.
"""

from __future__ import annotations

import datetime as dt
import io
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np

from terra_energy_engine import protocol

NCSS = 'https://thredds.ucar.edu/thredds/ncss/grid/grib/NCEP/GFS/Global_0p25deg/Best'
U = 'u-component_of_wind_height_above_ground'
V = 'v-component_of_wind_height_above_ground'

# The heights GFS publishes wind at that matter here: the surface standard, and
# a hub height.
HEIGHTS_M = (10, 100)

# South America and the ocean either side of it, west, south, east, north.
REGION = (-95.0, -50.0, -10.0, 15.0)
# Every other 0.25 degree point: half a degree.
STRIDE = 2

TIMEOUT_S = 40
# A field is kept for the hour it is valid in; GFS advances an hour at a time.
CACHE_MAX_AGE_S = 50 * 60


def subset_url(height_m: int, when: dt.datetime, region=REGION, stride: int = STRIDE) -> str:
    west, south, east, north = region
    q = [
        ('var', U), ('var', V),
        ('north', north), ('south', south), ('west', west), ('east', east),
        ('horizStride', stride),
        ('time', when.strftime('%Y-%m-%dT%H:00:00Z')),
        ('vertCoord', height_m),
        ('accept', 'netcdf3'),
    ]
    return f'{NCSS}?{urllib.parse.urlencode(q)}'


_SINCE = re.compile(r'(?i)^\s*hours?\s+since\s+(\S+)')


def _hours_since(units: bytes | str, value: float) -> dt.datetime:
    text = units.decode() if isinstance(units, bytes) else units
    m = _SINCE.match(text)
    if not m:
        raise ValueError(f'unexpected time units {text!r}')
    base = dt.datetime.fromisoformat(m.group(1).replace('Z', '+00:00'))
    if base.tzinfo is None:
        base = base.replace(tzinfo=dt.UTC)
    return base + dt.timedelta(hours=float(value))


def parse(content: bytes, height_m: int) -> dict:
    """
    A NetCDF 3 subset to the field the interface draws: a regular grid, west
    to east and north to south, longitudes in -180..180, speeds in m/s rounded
    to a tenth, NaN where the model has no value.
    """
    from scipy.io import netcdf_file

    with netcdf_file(io.BytesIO(content), 'r', mmap=False) as f:
        lat = np.asarray(f.variables['latitude'][:], dtype=float)
        lon = np.asarray(f.variables['longitude'][:], dtype=float)
        u = np.asarray(f.variables[U][:], dtype=float).reshape(lat.size, lon.size)
        v = np.asarray(f.variables[V][:], dtype=float).reshape(lat.size, lon.size)
        tv = f.variables['time']
        valid = _hours_since(tv.units, float(np.ravel(tv[:])[0]))
        run = None
        if 'reftime' in f.variables:
            rv = f.variables['reftime']
            run = _hours_since(rv.units, float(np.ravel(rv[:])[0]))

    lon = np.where(lon > 180, lon - 360, lon)
    order_lon = np.argsort(lon)
    order_lat = np.argsort(-lat)
    lon, lat = lon[order_lon], lat[order_lat]
    u = u[order_lat][:, order_lon]
    v = v[order_lat][:, order_lon]
    if lon.size < 2 or lat.size < 2:
        raise ValueError('the subset holds fewer than two points a side')

    def flat(a):
        a = np.where(np.isfinite(a) & (np.abs(a) < 200), np.round(a, 1), np.nan)
        return [None if np.isnan(x) else float(x) for x in a.ravel()]

    iso = lambda t: t.astimezone(dt.UTC).strftime('%Y-%m-%dT%H:%M:%SZ')
    return {
        'height_m': int(height_m),
        'valid': iso(valid),
        'run': iso(run) if run else None,
        'lon0': float(lon[0]),
        'lat0': float(lat[0]),
        'dlon': float(lon[1] - lon[0]),
        'dlat': float(lat[0] - lat[1]),
        'nx': int(lon.size),
        'ny': int(lat.size),
        'u': flat(u),
        'v': flat(v),
        'source': 'NOAA GFS 0.25°, subset by UCAR THREDDS',
        'note': (
            'A forecast field, not a measurement: the hour it is valid for, '
            'from the model run named with it. Wind at one height, at half a '
            'degree, so a valley or a coast is smoother here than on the ground.'
        ),
    }


def fetch(height_m: int, cache_dir: Path | None, now: dt.datetime | None = None) -> dict:
    now = now or dt.datetime.now(dt.UTC)
    hour = now.replace(minute=0, second=0, microsecond=0)
    cached = cache_dir / f'gfs-wind-{height_m}m-{hour:%Y%m%dT%H}.nc' if cache_dir else None
    if cached and cached.exists() and time.time() - cached.stat().st_mtime < CACHE_MAX_AGE_S:
        try:
            return parse(cached.read_bytes(), height_m)
        except Exception:
            cached.unlink(missing_ok=True)

    url = subset_url(height_m, hour)
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT_S) as fh:
            content = fh.read()
    except urllib.error.HTTPError as e:
        raise protocol.Unavailable(f'the GFS wind field could not be read: THREDDS answered {e.code}') from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        reason = getattr(e, 'reason', e)
        raise protocol.Unavailable(f'the GFS wind field could not be reached: {reason}') from e

    field = parse(content, height_m)
    if cached:
        try:
            cached.write_bytes(content)
        except OSError:
            pass  # a cache that cannot be written costs a fetch, nothing more
    return field
