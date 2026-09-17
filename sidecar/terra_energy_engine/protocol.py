"""
The contract between the desktop shell and the sidecar.

One JSON request arrives on stdin. While the work runs, progress objects are
written to stderr, one per line: {"progress": 0-100, "msg": "..."}. The result
is written to stdout as a single JSON object. A failure writes {"error": "..."}
to stderr and exits with status 1.

Nothing else may write to stdout: the shell parses all of it as the result.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Callable
from typing import Any, NoReturn

Request = dict[str, Any]


class MissingDependency(RuntimeError):
    """A package this path needs is not in this interpreter."""


class Unavailable(RuntimeError):
    """
    Something a run needs exists outside the code and is not there: a database
    that is not running, a record that was never loaded. Answered by the user
    doing something in the world, so the message has to say which thing. As
    TERRA's terra/protocol.py.
    """


def emit_progress(progress: int, msg: str) -> None:
    """Write one progress object to stderr. Use -1 for a message without a value."""
    sys.stderr.write(json.dumps({'progress': progress, 'msg': msg}) + '\n')
    sys.stderr.flush()


def reply(result: dict[str, Any]) -> None:
    """Write the result to stdout. Called once, at the end of an action."""
    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()


def fail(msg: str) -> NoReturn:
    """Write an error to stderr and exit non-zero."""
    sys.stderr.write(json.dumps({'error': msg}) + '\n')
    sys.stderr.flush()
    sys.exit(1)


# --- Request parameters ----------------------------------------------------
#
# ABSENCE SELECTS THE DEFAULT, NOT FALSINESS. `float(req.get(key) or default)`
# reads a deliberate 0 as an omission, because 0 is falsy in Python. In TERRA
# that turned a degradation rate of 0 %/yr into the 0.5 %/yr default and a
# 0 m/s calm threshold into the wind default. Every numeric parameter is read
# through these two helpers so the pattern cannot come back one call site at a
# time. Carried over from TERRA's terra/protocol.py unchanged.

def request_number[T](
    req: Request,
    key: str,
    default: T,
    cast: Callable[[Any], Any] = float,
) -> Any:
    """
    A numeric request parameter, defaulted only when the caller omitted it.

    The default is returned as given rather than cast, so a default of None
    stays None for the parameters whose absence is itself the signal.
    """
    value = req.get(key)
    if value is None:
        return default
    return cast(value)


def request_positive[T](
    req: Request,
    key: str,
    default: T,
    cast: Callable[[Any], Any] = float,
    allow_zero: bool = False,
) -> Any:
    """
    A numeric request parameter that has to be positive, or the run fails.

    For quantities where zero is not a value but a broken request, such as a
    record of zero years. Rejecting is the honest answer; substituting the
    default would report a figure the caller did not ask for.
    """
    value = request_number(req, key, default, cast)
    if value < 0 or (value == 0 and not allow_zero):
        fail(
            f"{key} must be "
            f"{'zero or greater' if allow_zero else 'greater than zero'}, "
            f"got {value}"
        )
    return value
