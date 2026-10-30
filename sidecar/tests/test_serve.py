"""The served mode: one request per line, the interpreter surviving each failure."""
import json
import subprocess
import sys
from pathlib import Path

from terra_energy_engine import protocol
from terra_energy_engine.cli import handle

MAIN = Path(__file__).resolve().parents[1] / 'main.py'


def test_a_served_request_answers_as_a_one_shot_run_would():
    assert handle('{"action": "ping"}')['result']['ok'] is True
    assert handle('{"action": "no_such_action"}') == {'error': "unknown action: 'no_such_action'"}
    assert handle('[1]') == {'error': 'the request must be a JSON object'}
    assert handle('{}') == {'error': 'the request names no action'}
    assert handle('nope')['error'].startswith('invalid request JSON')
    assert protocol.answer is None


def test_a_failing_action_fails_its_request_only(monkeypatch):
    from terra_energy_engine import registry

    def raises(req):
        raise ValueError('bad input')

    def exits(req):
        sys.exit(2)

    def silent(req):
        pass

    for action, expected in [(raises, 'ValueError: bad input'), (exits, 'the action exited with status 2'),
                             (silent, 'the action produced no result')]:
        monkeypatch.setattr(registry, 'resolve', lambda name, a=action: a)
        assert handle('{"action": "x"}') == {'error': expected}
    assert protocol.answer is None


def test_the_interpreter_serves_lines_and_keeps_stdout_for_answers():
    lines = '\n'.join(['{"action": "ping"}', '{"action": "no_such_action"}', '{"action": "ping"}']) + '\n'
    done = subprocess.run([sys.executable, str(MAIN), '--serve'], input=lines, capture_output=True, text=True, timeout=60)
    answers = [json.loads(line) for line in done.stdout.splitlines()]
    assert [('result' in a) for a in answers] == [True, False, True]
    assert done.returncode == 0
