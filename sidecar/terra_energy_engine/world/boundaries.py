"""
Administrative boundaries of any country, from geoBoundaries.

WHY THIS EXISTS. An area is taken from a catalogue and never drawn, and the
catalogue was IBGE's: outside Brazil there was no way to name a ground at all,
so the products that need none of Brazil's records -- the solar terrain reads a
global elevation model -- could not be asked anywhere else. geoBoundaries
publishes every country's subdivisions under one open licence (CC BY 4.0), one
file per country and level, which is what a catalogue needs.

THE SIMPLIFIED FILES, AND WHAT THAT COSTS. The full-resolution levels run to
hundreds of megabytes for a large country; the simplified ones are what a
desktop can hold (Italy's regions 1.3 MB, Brazil's municipalities 41). A
simplified outline misplaces an edge by some hundreds of metres, so an area
taken from here is that much less exact than one from IBGE or from a store's
own solara.boundary, both of which are preferred where they exist.

READ HERE AND NOT IN THE WEBVIEW. The files sit behind a redirect to a large
file store that answers a browser without the headers a cross-origin read
needs, and a level is worth keeping on disk between sessions. One file per
country and level is cached and every later question is answered from it.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from terra_energy_engine import protocol

API = 'https://www.geoboundaries.org/api/current/gbOpen'
TIMEOUT_S = 120
# Boundaries change with a country's own reforms, a few times a decade.
CACHE_MAX_AGE_S = 90 * 24 * 3600
CREDIT = 'geoBoundaries (CC BY 4.0)'


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': 'solara'})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as fh:
            return fh.read()
    except urllib.error.HTTPError as e:
        raise protocol.Unavailable(f'geoBoundaries answered {e.code} for {url}') from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise protocol.Unavailable(
            f'geoBoundaries could not be reached: {getattr(e, "reason", e)}') from e


def _cached(cache_dir: Path | None, name: str, url_of) -> bytes:
    """The file `name` from the cache, or fetched from `url_of()` and kept."""
    path = cache_dir / name if cache_dir else None
    if path and path.exists() and time.time() - path.stat().st_mtime < CACHE_MAX_AGE_S:
        return path.read_bytes()
    content = _get(url_of())
    if path:
        try:
            partial = path.with_suffix(path.suffix + '.partial')
            partial.write_bytes(content)
            partial.replace(path)
        except OSError:
            pass  # a cache that cannot be written costs a fetch, nothing more
    return content


def _iso(raw: Any) -> str:
    iso = str(raw or '').strip().upper()
    if len(iso) != 3 or not iso.isalpha():
        protocol.fail(f'iso3 must be a three-letter country code, got {raw!r}')
    return iso


def _level(raw: Any) -> int:
    try:
        level = int(raw)
    except (TypeError, ValueError):
        protocol.fail(f'level must be a number from 0 to 5, got {raw!r}')
    if not 0 <= level <= 5:
        protocol.fail(f'level must be a number from 0 to 5, got {raw!r}')
    return level


def countries(cache_dir: Path | None) -> list[dict[str, str]]:
    """Every country geoBoundaries publishes, by name."""
    rows = json.loads(_cached(cache_dir, 'countries.json', lambda: f'{API}/ALL/ADM0/'))
    seen: dict[str, str] = {}
    for r in rows:
        iso, name = r.get('boundaryISO'), r.get('boundaryName')
        if iso and name:
            seen[iso] = name
    return [{'iso3': iso, 'name': name} for iso, name in sorted(seen.items(), key=lambda kv: kv[1])]


def _meta(cache_dir: Path | None, iso: str) -> list[dict[str, Any]]:
    rows = json.loads(_cached(cache_dir, f'{iso}-levels.json', lambda: f'{API}/{iso}/ALL/'))
    return rows if isinstance(rows, list) else [rows]


def levels(cache_dir: Path | None, iso: str) -> list[dict[str, Any]]:
    """The levels a country is published at: 0 is the country, 1 its first subdivision."""
    out = []
    for r in _meta(cache_dir, iso):
        kind = str(r.get('boundaryType') or '')
        if not kind.startswith('ADM'):
            continue
        canonical = str(r.get('boundaryCanonical') or '').strip()
        try:
            count = int(r.get('admUnitCount') or 0)
        except ValueError:
            count = 0
        out.append({
            'level': int(kind[3:]),
            # geoBoundaries names the level where its source did; mostly it did not.
            'name': canonical if canonical and canonical.lower() not in ('unknown', 'gbopen') else '',
            'count': count,
        })
    return sorted(out, key=lambda r: r['level'])


def _features(cache_dir: Path | None, iso: str, level: int) -> list[dict[str, Any]]:
    def url() -> str:
        for r in _meta(cache_dir, iso):
            if r.get('boundaryType') == f'ADM{level}':
                return r.get('simplifiedGeometryGeoJSON') or r['gjDownloadURL']
        raise protocol.Unavailable(f'geoBoundaries publishes no level {level} for {iso}')

    data = json.loads(_cached(cache_dir, f'{iso}-ADM{level}.geojson', url))
    return data.get('features') or []


def places(cache_dir: Path | None, iso: str, level: int) -> list[dict[str, str]]:
    """The boundaries of one level by name, without their shapes."""
    out = []
    for i, f in enumerate(_features(cache_dir, iso, level)):
        p = f.get('properties') or {}
        out.append({'id': str(p.get('shapeID') or i), 'name': str(p.get('shapeName') or f'{iso} {i + 1}')})
    return sorted(out, key=lambda r: r['name'])


def shape(cache_dir: Path | None, iso: str, level: int, boundary_id: str) -> dict[str, Any]:
    """One boundary with its outline."""
    for i, f in enumerate(_features(cache_dir, iso, level)):
        p = f.get('properties') or {}
        if str(p.get('shapeID') or i) == boundary_id and f.get('geometry'):
            return {'id': boundary_id, 'name': str(p.get('shapeName') or ''), 'geometry': f['geometry']}
    raise protocol.Unavailable(f'geoBoundaries holds no boundary {boundary_id!r} at level {level} of {iso}')


# ---- The actions --------------------------------------------------------------------


def _cache_dir(req: protocol.Request) -> Path | None:
    raw = req.get('boundary_cache_dir')
    path = Path(raw) if raw else Path.home() / '.cache' / 'terra-energy-engine' / 'boundaries'
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None
    return path


def world_countries(req: protocol.Request) -> None:
    protocol.reply({'world_countries': {'countries': countries(_cache_dir(req)), 'credit': CREDIT}})


def world_boundaries(req: protocol.Request) -> None:
    """A country's levels; with `level`, that level's boundaries; with `id` too, one outline."""
    cache, iso = _cache_dir(req), _iso(req.get('iso3'))
    if req.get('level') is None:
        protocol.reply({'world_boundaries': {'iso3': iso, 'levels': levels(cache, iso)}})
        return
    level = _level(req.get('level'))
    if req.get('id') is not None:
        protocol.reply({'world_boundaries': {'iso3': iso, 'level': level,
                                             'boundary': shape(cache, iso, level, str(req['id']))}})
        return
    protocol.reply({'world_boundaries': {'iso3': iso, 'level': level, 'places': places(cache, iso, level)}})
