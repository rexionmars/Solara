# PyInstaller onedir: the interpreter and native scientific/geospatial libraries
# travel together. Native builds on each OS/architecture; never cross-freeze.
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_submodules, copy_metadata, collect_delvewheel_libs_directory

root = Path(SPECPATH).parents[1]
sys.path.insert(0, str(root / 'sidecar'))
datas, binaries = [], []
hiddenimports = collect_submodules('terra_energy_engine')
for package in ('pypsa', 'highspy', 'rasterio', 'pyproj'):
    data, binary, hidden = collect_all(package)
    datas += data
    binaries += binary
    hiddenimports += hidden
# Windows HiGHS wheels keep a renamed VC runtime in the sibling .libs folder.
# Preserve that directory so the wheel's DLL loader can find it after relocation.
datas, binaries = collect_delvewheel_libs_directory('highspy', datas=datas, binaries=binaries)
for distribution in ('pypsa', 'highspy', 'linopy'):
    datas += copy_metadata(distribution)
a = Analysis([str(root / 'scripts' / 'release' / 'engine_main.py')], pathex=[str(root / 'sidecar')],
             binaries=binaries, datas=datas, hiddenimports=hiddenimports,
             excludes=['pytest', 'IPython', 'notebook', 'jupyterlab', 'tkinter'], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='solara-engine',
          debug=False, strip=False, upx=False, console=True)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='solara-engine')
