#!/usr/bin/env python3
"""
The sidecar entry point.

internal/sidecar/runner.go starts `python sidecar/main.py`, so this path is
part of the contract with the Go side. What the process does is in
terra_energy_engine.cli.

Run as a script, this file's directory is sys.path[0] and
`terra_energy_engine` imports without any path manipulation.
"""

from terra_energy_engine.cli import main

if __name__ == '__main__':
    main()
