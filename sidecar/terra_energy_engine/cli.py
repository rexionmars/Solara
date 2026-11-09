"""
One request in, one result out, then the process ends; or, with --serve, one
request per line for as long as stdin stays open.
"""

from __future__ import annotations

import json
import os
import platform
import sys
import traceback

from terra_energy_engine import protocol, registry


def main() -> None:
    if sys.argv[1:] == ['--serve']:
        serve()
        return
    try:
        req = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        protocol.fail(f'invalid request JSON: {e}')
    if not isinstance(req, dict):
        protocol.fail('the request must be a JSON object')
    action = req.get('action')
    if not isinstance(action, str):
        protocol.fail('the request names no action')
    try:
        registry.resolve(action)(req)
    except (protocol.MissingDependency, protocol.Unavailable) as e:
        # Said in the user's terms by whoever raised it; a traceback here would
        # reach the interface as "exit status 1" and nothing else.
        protocol.fail(str(e))


def ping(req: protocol.Request) -> None:
    """Health check: the interpreter starts and the package imports."""
    protocol.reply({'ok': True, 'python': platform.python_version()})


def serve() -> None:
    """
    Answer requests one per line until stdin closes, so a read skips the start.

    Starting an interpreter and importing what a read needs costs about 0.3 s,
    paid on every pan of a map layer when each request has its own process
    (internal/sidecar/worker.go keeps these running instead). Each line on
    stdin is a request; each line written back is {"result": ...} or
    {"error": "..."}. Progress still goes to stderr. File descriptor 1 is
    pointed at stderr while serving, so nothing a library prints, from Python
    or from C, can land among the answers, which go to a copy of the original.
    """
    answers = os.fdopen(os.dup(1), 'w', encoding='utf-8')
    os.dup2(2, 1)
    for raw in sys.stdin.buffer:
        if raw.strip():
            answers.write(json.dumps(handle(raw.decode('utf-8'))) + '\n')
            answers.flush()


def handle(line: str) -> dict:
    """One served request: its result, or the error a one-shot run would have exited with."""
    results: list[dict] = []
    protocol.answer = results.append
    try:
        req = json.loads(line)
        if not isinstance(req, dict):
            return {'error': 'the request must be a JSON object'}
        action = req.get('action')
        if not isinstance(action, str):
            return {'error': 'the request names no action'}
        registry.resolve(action)(req)
    except json.JSONDecodeError as e:
        return {'error': f'invalid request JSON: {e}'}
    except (protocol.Failure, protocol.MissingDependency, protocol.Unavailable) as e:
        return {'error': str(e)}
    except SystemExit as e:
        return {'error': f'the action exited with status {e.code}'}
    except Exception as e:
        # A one-shot run would end on this traceback; the interpreter serves on.
        traceback.print_exc()
        return {'error': f'{type(e).__name__}: {e}'}
    finally:
        protocol.answer = None
    if not results:
        return {'error': 'the action produced no result'}
    return {'result': results[-1]}
