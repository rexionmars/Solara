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
        from rasterio.warp import transform
        # Both wheels carry PROJ; exercise both paths after relocation.
        expected = 111319.49079327357
        x, _ = pyproj.Transformer.from_crs(4326, 3857, always_xy=True).transform(1, 1)
        assert abs(x - expected) < 0.01
        xs, _ = transform('EPSG:4326', 'EPSG:3857', [1], [1])
        assert abs(xs[0] - expected) < 0.01
        print(json.dumps({'ok': True, 'actions': len(ACTIONS), 'pypsa': pypsa.__version__,
                          'highs': highspy.Highs().version()}))
    else:
        main()
