"""
The point summary the solar resource reports its geometry and yield by.

The four tests TERRA's test_energy_summaries.py holds for pv.summarise_point;
the rest of that file tests the plant model, which arrives with it.
"""

from __future__ import annotations

import pytest

from terra_energy_engine.energy import pv

BEST = {'tilt_deg': 22.4, 'poa_kwh_m2_year': 2100.0}


def point(**over):
    args = dict(yield_year=1700.0, pr_applied=0.83, pr_source='reference',
                pr_modelled=0.877, n_years=10)
    args.update(over)
    return pv.summarise_point(BEST, 1900.0, {'band_deg': 5}, 0.0, **args)


def test_the_gain_is_against_the_horizontal_plane():
    out = point()

    assert out['geometry']['gain_over_horizontal_pct'] == pytest.approx(
        100.0 * (2100.0 / 1900.0 - 1.0), abs=1e-2)


def test_no_horizontal_total_reports_no_gain_rather_than_dividing_by_zero():
    """
    A polar winter, or a record that returned no radiation. A run that got this
    far has a resource answer worth returning, and the division is the only
    thing that cannot be done.
    """
    out = pv.summarise_point(BEST, 0.0, None, 0.0, yield_year=1700.0,
                             pr_applied=0.83, pr_source='reference',
                             pr_modelled=0.877, n_years=10)

    assert out['geometry']['gain_over_horizontal_pct'] == 0.0


def test_the_capacity_factor_is_the_yield_over_the_hours_in_a_year():
    """What makes a site comparable with a plant of any size."""
    out = point(yield_year=1752.0)

    assert out['pv']['capacity_factor_pct'] == pytest.approx(20.0, abs=1e-2)


def test_both_ratios_are_reported_so_the_assumption_is_visible():
    out = point()

    assert out['pv']['performance_ratio'] == 0.83
    assert out['pv']['performance_ratio_modelled'] == 0.877
    assert out['pv']['performance_ratio_source'] == 'reference'
