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
