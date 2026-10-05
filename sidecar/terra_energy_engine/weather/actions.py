"""The weather questions the shell can ask."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from terra_energy_engine import protocol
from terra_energy_engine.protocol import Request


def _cache_dir(req: Request) -> Path | None:
    raw = req.get('wind_cache_dir')
    path = Path(raw) if raw else Path.home() / '.cache' / 'terra-energy-engine' / 'wind'
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None
    return path


def wind_field(req: Request) -> None:
    """The GFS wind at one height for the hour now, over `region` or, without one, South America."""
    from terra_energy_engine.weather import wind

    height = protocol.request_number(req, 'height_m', 10, int)
    if height not in wind.HEIGHTS_M:
        protocol.fail(f'height_m must be one of {list(wind.HEIGHTS_M)}, got {height}')
    region = wind.REGION
    if req.get('region') is not None:
        try:
            west, south, east, north = (float(v) for v in req['region'])
        except (TypeError, ValueError):
            protocol.fail('region must be [west, south, east, north] in degrees')
        if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
            protocol.fail(f'region must be [west, south, east, north] in degrees, got {req["region"]}')
        region = (west, south, east, north)
    field = wind.fetch(height, _cache_dir(req), region=region)
    sys.stdout.write(json.dumps({'wind_field': field}, allow_nan=False))
    sys.stdout.flush()
