"""Keep vendored native libraries private to their wheel on macOS.

GDAL/rasterio and pyproj can ship different, symbol-renamed builds of PROJ
with the same filename. PyInstaller's shared @rpath alias would mix them.
Restore existing wheel-local @loader_path references before final signing.
"""
import importlib.util
import os
from pathlib import Path
import subprocess


def repair(engine):
    for package in ('pyproj', 'rasterio', 'shapely'):
        source = Path(importlib.util.find_spec(package).origin).parent
        target = engine / '_internal' / package
        for original in source.rglob('*'):
            if original.suffix not in ('.so', '.dylib') or not original.is_file():
                continue
            frozen = target / original.relative_to(source)
            if not frozen.is_file() or frozen.is_symlink():
                continue
            dependencies = subprocess.check_output(['otool','-L',str(original)],text=True).splitlines()[1:]
            changed = False
            for line in dependencies:
                dependency = line.strip().split(' (compatibility',1)[0]
                if not dependency.startswith('@loader_path/'):
                    continue
                resolved = (original.parent / dependency.removeprefix('@loader_path/')).resolve()
                if not resolved.is_relative_to(source.resolve()):
                    continue
                bundled = target / resolved.relative_to(source.resolve())
                if not bundled.is_file():
                    raise RuntimeError(f'Missing vendored library: {bundled}')
                private = '@loader_path/' + os.path.relpath(bundled, frozen.parent)
                subprocess.run(['install_name_tool','-change','@rpath/'+resolved.name,private,str(frozen)],check=True)
                changed = True
            if changed:
                subprocess.run(['codesign','--force','--sign','-',str(frozen)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
