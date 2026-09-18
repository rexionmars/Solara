"""
The photovoltaic chain, offline.

The three tests TERRA's test_pv.py holds for energy/pv.py. The rest of that file
tests the terrain irradiance, the season windows and the colour policy, which
arrive with the terrain product.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from terra_energy_engine.energy import pv as pv_mod


def test_reference_performance_ratio_is_below_the_modelled_one():
    """
    The chain omits soiling, inter-row shading, degradation, availability and
    cabling, so what it models runs high. The reference applied by default must
    sit below it, or the calibration would not be doing anything.
    """
    assert pv_mod.REFERENCE_PERFORMANCE_RATIO < 0.85
    assert 0.7 < pv_mod.REFERENCE_PERFORMANCE_RATIO < 0.9


def test_modelled_performance_ratio_is_energy_over_reference_energy():
    p_ac = pd.Series([800.0, 800.0])
    poa = pd.Series([1000.0, 1000.0])
    # 1.6 kWh AC over 2.0 kWh at STC efficiency for a 1 kWp array.
    assert abs(pv_mod.modelled_performance_ratio(p_ac, poa) - 0.8) < 1e-9


def test_modelled_performance_ratio_handles_no_irradiance():
    assert np.isnan(
        pv_mod.modelled_performance_ratio(pd.Series([0.0]), pd.Series([0.0]))
    )
