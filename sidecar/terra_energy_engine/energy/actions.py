"""
The energy actions: the solar resource and the wind screening at a site.

Ported from TERRA's terra/energy/actions.py. The computation is TERRA's,
unchanged; what differs is the input. TERRA takes a polygon and reads its
centroid, and this takes the site itself as a longitude and latitude, because
the resource at a point is what both products report and this application has
no area to take a centroid of yet.

Each action reads its request, runs the product, and writes one JSON object to
stdout. The heavy imports are deferred into the function bodies, so a request
for one action does not pay for the other's dependencies.
"""

from __future__ import annotations

import math

from terra_energy_engine import protocol


def request_site(req: protocol.Request) -> tuple[float, float]:
    """The site as (lon, lat) in degrees, refused when absent or off the globe."""
    try:
        lon = float(req['lon'])
        lat = float(req['lat'])
    except (KeyError, TypeError, ValueError):
        protocol.fail('the request needs the site as lon and lat, in degrees')
    if not (math.isfinite(lon) and math.isfinite(lat)
            and -180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0):
        protocol.fail(f'{lon}, {lat} is not a longitude and latitude')
    return lon, lat


def request_performance_ratio(req: protocol.Request) -> float | None:
    """
    The caller's performance ratio, or None to apply the reference one.

    Refused unless it lies in (0, 1]. A boolean is refused too: Python counts
    True as the integer 1, and a ratio of 1.0 is not what anyone sending a flag
    meant.
    """
    value = req.get('performance_ratio')
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 < value <= 1:
        protocol.fail(f'performance_ratio must be a number in (0, 1], got {value!r}')
    return float(value)


# Solar resource and photovoltaic yield at the site (no imagery).
def solar_resource(req: protocol.Request) -> None:
    from datetime import date as _date

    import numpy as np

    from terra_energy_engine.energy import pv as pv_mod
    from terra_energy_engine.sun import (
        cache as power_cache,
        nasa_power as sun_power,
        position as sun_position,
        record as sun_record,
    )

    site_lon, site_lat = request_site(req)
    lon, lat = sun_power.request_point(site_lon, site_lat)

    clim_years = protocol.request_positive(req, 'climatology_years', 30, int)
    hourly_years = protocol.request_positive(req, 'hourly_years', 10, int)
    # Zero is due north here, which is both the default and a value the
    # caller can mean, so absence is what selects the default.
    azimuth = protocol.request_number(req, 'surface_azimuth', 0.0)
    pr_override = request_performance_ratio(req)

    # POWER publishes through the previous full year.
    last_year = _date.today().year - 1
    clim_start = f'{last_year - clim_years + 1}0101'
    clim_end = f'{last_year}1231'
    hourly_start = f'{last_year - hourly_years + 1}0101'
    hourly_end = f'{last_year}1231'

    cache = power_cache.power_cache_dir(req)
    protocol.emit_progress(5, f'NASA POWER daily, {clim_years} years')
    try:
        daily, daily_provenance = power_cache.cached_power_series(
            cache, 'daily', lon, lat, clim_start, clim_end,
            sun_power.DAILY_PARAMS,
            lambda progress: sun_power.fetch(
                'daily', lon, lat, clim_start, clim_end, progress=progress
            ),
            progress=lambda i, n, y: protocol.emit_progress(
                5 + int(35 * (i + 1) / n), f'daily {y}'
            ),
        )
    except Exception as e:
        protocol.fail(f'NASA POWER daily request failed: {e}')

    annual = sun_record.annual_totals(daily)
    if annual.empty:
        protocol.fail('NASA POWER returned no complete year for this point')
    slope, pvalue = sun_record.linear_trend(annual)
    resource = {
        'ghi_annual_kwh_m2': round(float(annual.mean()), 1),
        'ghi_std': round(float(annual.std(ddof=1)), 1) if annual.size > 1 else 0.0,
        'ghi_cv_pct': (
            round(float(100.0 * annual.std(ddof=1) / annual.mean()), 2)
            if annual.size > 1 and annual.mean() else 0.0
        ),
        'ghi_p10': round(float(np.percentile(annual.values, 10)), 1),
        'ghi_p90': round(float(np.percentile(annual.values, 90)), 1),
        'n_years': int(annual.size),
        'trend_per_year': round(slope, 3),
        'trend_p_value': round(pvalue, 4),
        'clear_sky_index': sun_record.clear_sky_index(daily),
        'monthly': sun_record.monthly_climatology(daily),
    }

    protocol.emit_progress(42, f'NASA POWER hourly, {hourly_years} years')
    try:
        hourly, hourly_provenance = power_cache.cached_power_series(
            cache, 'hourly', lon, lat, hourly_start, hourly_end,
            sun_power.HOURLY_PARAMS,
            lambda progress: sun_power.fetch(
                'hourly', lon, lat, hourly_start, hourly_end,
                progress=progress,
            ),
            progress=lambda i, n, y: protocol.emit_progress(
                42 + int(38 * (i + 1) / n), f'hourly {y}'
            ),
        )
    except Exception as e:
        protocol.fail(f'NASA POWER hourly request failed: {e}')

    df, solpos = sun_position.prepare_hourly(hourly, lat, lon, 0.0)
    if df.empty:
        protocol.fail('NASA POWER returned no usable hourly record for this point')
    n_years = max(len(set(df.index.year)), 1)

    protocol.emit_progress(84, 'optimum tilt')
    sweep = pv_mod.sweep_tilt(df, solpos, azimuth, n_years)
    best = max(sweep, key=lambda r: r['poa_kwh_m2_year'])
    horizontal = next(
        (r['poa_kwh_m2_year'] for r in sweep if abs(r['tilt_deg']) < 1e-9),
        best['poa_kwh_m2_year'],
    )
    tolerance = []
    for dev in (5.0, 10.0, 15.0):
        near = [
            r for r in sweep
            if abs(abs(r['tilt_deg'] - best['tilt_deg']) - dev) < 0.26
        ]
        if near:
            worst = min(near, key=lambda r: r['poa_kwh_m2_year'])
            loss = 100.0 * (1.0 - worst['poa_kwh_m2_year'] / best['poa_kwh_m2_year'])
            tolerance.append({
                'deviation_deg': dev, 'loss_pct': round(float(loss), 2)
            })

    protocol.emit_progress(92, 'photovoltaic yield')
    poa = pv_mod.transpose(df, solpos, best['tilt_deg'], azimuth)
    p_ac = pv_mod.pv_yield(poa, df, solpos, best['tilt_deg'], azimuth)
    pr_modelled = pv_mod.modelled_performance_ratio(p_ac, poa['poa_global'])
    pr_applied = pr_override if pr_override is not None else pv_mod.REFERENCE_PERFORMANCE_RATIO
    pr_source = 'user' if pr_override is not None else 'reference'
    poa_year = float(poa['poa_global'].sum()) / 1000.0 / n_years
    # Specific yield is POA times the performance ratio by construction, so
    # applying a reference ratio is exact rather than a correction factor.
    yield_year = poa_year * pr_applied

    protocol.emit_progress(100, 'done')
    summary = pv_mod.summarise_point(
        best, horizontal, tolerance, azimuth,
        yield_year=yield_year, pr_applied=pr_applied, pr_source=pr_source,
        pr_modelled=pr_modelled, n_years=n_years,
    )
    protocol.reply({
        'solar': {
            'lon': lon, 'lat': lat,
            'resource': resource,
            **summary,
            'grid_note': sun_power.GRID_NOTE,
            # Which POWER series this run read and when it was fetched. Without
            # it a cached run and a fetched run are indistinguishable to the
            # caller, and POWER reprocesses historical data.
            'power_provenance': {
                'daily': daily_provenance,
                'hourly': hourly_provenance,
            },
        }
    })


# Wind resource screening at the site, from POWER hourly MERRA-2.
def wind_resource(req: protocol.Request) -> None:
    from datetime import date as _date

    from terra_energy_engine.energy import wind as wind_mod
    from terra_energy_engine.sun import cache as power_cache, nasa_power as sun_power

    site_lon, site_lat = request_site(req)
    # The MERRA-2 cell centre, not the site: the request resolves to a cell
    # and the response has to say which cell it describes.
    lon, lat = sun_power.meteorology_cell(site_lon, site_lat)

    record_years = protocol.request_positive(
        req, 'record_years', wind_mod.RECORD_YEARS, int
    )
    hub_height_m = protocol.request_positive(
        req, 'hub_height_m', wind_mod.HUB_HEIGHT_M
    )
    # Zero is a caller stating that no hour counts as calm, and zero is a
    # caller stating that the record maximum needs no floor. Both are
    # values; only absence selects the wind module's convention.
    calm_threshold = protocol.request_positive(
        req, 'calm_threshold_ms', wind_mod.CALM_THRESHOLD_MS,
        allow_zero=True,
    )
    record_max_floor = protocol.request_positive(
        req, 'record_max_floor_ms', wind_mod.RECORD_MAX_FLOOR_MS,
        allow_zero=True,
    )
    band = req.get('roughness_band_m') or wind_mod.ROUGHNESS_BAND_M
    try:
        roughness_band = (float(band[0]), float(band[1]))
    except (TypeError, IndexError, ValueError):
        protocol.fail('roughness_band_m must be two roughness lengths in metres')

    last_year = _date.today().year - 1
    start, end = wind_mod.record_period(last_year, record_years)
    record_window = f'{start[:4]}-{end[:4]} hourly'

    protocol.emit_progress(5, f'NASA POWER hourly wind, {record_years} years')
    try:
        df, hourly_provenance = power_cache.cached_power_series(
            power_cache.power_cache_dir(req), 'hourly', lon, lat, start, end,
            wind_mod.HOURLY_PARAMS,
            lambda progress: wind_mod.fetch(
                lon, lat, start, end, progress=progress
            ),
            progress=lambda i, n, y: protocol.emit_progress(
                5 + int(80 * (i + 1) / n), f'hourly {y}'
            ),
        )
    except Exception as e:
        protocol.fail(f'NASA POWER hourly request failed: {e}')
    if df.empty:
        protocol.fail('NASA POWER returned no hourly record for this point')

    protocol.emit_progress(90, 'shear, Weibull fit and turbine power')
    try:
        assessment = wind_mod.assess(
            df, lon, lat,
            hub_height_m=hub_height_m,
            calm_threshold_ms=calm_threshold,
            record_max_floor_ms=record_max_floor,
            roughness_band_m=roughness_band,
        )
    except Exception as e:
        protocol.fail(f'wind assessment failed: {e}')

    assessment.update({
        'lon': lon, 'lat': lat,
        'record_window': record_window,
        'hub_height_m': hub_height_m,
        # Whether the POWER record behind this assessment was fetched or
        # read from the on-disk cache, and when it was fetched.
        'power_provenance': {'hourly': hourly_provenance},
        'assumptions': {
            'hub_height_m': hub_height_m,
            'hub_height_source': (
                'Hub height of the IEA-3.4-130 reference turbine, applied '
                'as a project convention. No turbine has been selected for '
                'this site.'
            ),
            'record_years': record_years,
            'record_window': record_window,
            'shear_exponent': assessment['measured']['shear_exponent'],
            'shear_exponent_source': (
                'Power law between the 10 m and 50 m long-term means of '
                'this record. Everything above 50 m is extrapolated.'
            ),
            'roughness_band_m': list(roughness_band),
            'calm_threshold_ms': calm_threshold,
            'record_max_floor_ms': record_max_floor,
            'qualifier': wind_mod.RESULT_QUALIFIER,
            'excluded_losses': list(wind_mod.EXCLUDED_LOSSES),
            'comparison_note': (
                'The gross capacity factor here and the photovoltaic '
                'capacity factor from solar_resource are not comparable. '
                'The photovoltaic figure is computed at a performance '
                'ratio benchmarked against the Global Solar Atlas; this '
                'one carries no external validation and no plant losses.'
            ),
        },
    })

    protocol.emit_progress(100, 'done')
    protocol.reply({'wind': assessment})
