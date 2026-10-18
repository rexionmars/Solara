"""Frozen entry point; normal stdin/stdout protocol remains unchanged."""
import json
import sys
from terra_energy_engine.cli import main

if __name__ == '__main__':
    if sys.argv[1:] == ['--check-runtime']:
        from terra_energy_engine.registry import ACTIONS, resolve
        for action in ACTIONS:
            resolve(action)
        # Exercise native libraries and the metadata imported lazily by planning.
        import highspy
        import pypsa
        import rasterio
        import pyproj
        import pyarrow
        import psycopg
        print(json.dumps({'ok': True, 'actions': len(ACTIONS), 'pypsa': pypsa.__version__,
                          'highs': highspy.Highs().version()}))
    else:
        main()
