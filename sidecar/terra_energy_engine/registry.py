"""
The action names the shell can request, and the function that answers each.

The table holds dotted paths as strings, and a module is imported only when its
action is the one requested, so a request never pays the import cost of a
product it does not use.
"""

from __future__ import annotations

import importlib
from collections.abc import Callable

from terra_energy_engine.protocol import Request, fail

Action = Callable[[Request], None]

ACTIONS: dict[str, str] = {
    'ping': 'terra_energy_engine.cli:ping',
    'solar_resource': 'terra_energy_engine.energy.actions:solar_resource',
    'wind_resource': 'terra_energy_engine.energy.actions:wind_resource',
    'solar_terrain': 'terra_energy_engine.energy.actions:solar_terrain',
    'parameter_defaults': 'terra_energy_engine.energy.actions:parameter_defaults',
    # The electrical system, read from the local PostGIS store. TERRA's names,
    # so a request can move between the two programs unchanged.
    'grid_coverage': 'terra_energy_engine.grid.actions:grid_coverage',
    'grid_plants': 'terra_energy_engine.grid.actions:grid_plants',
    'grid_network': 'terra_energy_engine.grid.actions:grid_network',
    'grid_congestion': 'terra_energy_engine.grid.actions:grid_congestion',
    # What the area already draws from the network, from the BDGD register.
    'demand_area': 'terra_energy_engine.grid.actions:demand_area',
    # How much of an area each register covers, asked before the reading runs.
    'demand_reach': 'terra_energy_engine.grid.actions:demand_reach',
    # Consumption by municipality, as a layer read before any area is chosen.
    'demand_towns': 'terra_energy_engine.grid.actions:demand_towns',
    'grid_concessions': 'terra_energy_engine.grid.actions:grid_concessions',
    # The named grounds of a store prepared to the contract (grid/contract.py).
    'store_boundaries': 'terra_energy_engine.grid.actions:store_boundaries',
    # The weather now, where only the sidecar can read the format.
    'wind_field': 'terra_energy_engine.weather.actions:wind_field',
}


def resolve(action: str) -> Action:
    """
    The function that answers `action`, imported at the moment it is needed.

    An unknown action is an error. It does not fall back to a default action,
    so a misspelled name fails at once instead of starting unrelated work.
    """
    target = ACTIONS.get(action)
    if target is None:
        fail(f'unknown action: {action!r}')
    module_path, _, name = target.partition(':')
    return getattr(importlib.import_module(module_path), name)
