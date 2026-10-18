"""Version stamping, native packaging and relocated runtime smoke checks."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]
SEMVER = re.compile(r'v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?')


def version(tag):
    match = SEMVER.fullmatch(tag)
    if not match:
        raise ValueError('Use a SemVer tag such as v0.1.0 or v0.2.0-rc.1.')
    return tag[1:], '.'.join(match.group(i) for i in (1, 2, 3)), bool(match.group(4))


def stamp(tag):
    full, numeric, prerelease = version(tag)
    path = ROOT / 'wails.json'
    config = json.loads(path.read_text())
    config['info']['productVersion'] = numeric
    path.write_text(json.dumps(config, indent=2) + '\n')
    print(json.dumps(dict(version=full, prerelease=prerelease)))
    if output := os.getenv('GITHUB_OUTPUT'):
        with open(output, 'a') as f:
            f.write(f'version={full}\nprerelease={str(prerelease).lower()}\n')


def engine_path(root, platform):
    if platform.startswith('darwin'):
        return root / 'Solara.app/Contents/Resources/engine/solara-engine'
    return root / 'engine' / ('solara-engine.exe' if platform.startswith('windows') else 'solara-engine')


def smoke(engine):
    # No project checkout, virtual environment or Python search path may help it.
    env = {k:v for k,v in os.environ.items() if k not in ('PYTHONPATH','PYTHONHOME','TERRA_ENERGY_APP_DIR','TERRA_ENERGY_PYTHON','VIRTUAL_ENV')}
    env['PYINSTALLER_RESET_ENVIRONMENT'] = '1'
    with tempfile.TemporaryDirectory(prefix='solara smoke ') as cwd:
        def run(args, request=None, timeout=180):
            proc = subprocess.run([str(engine.resolve()), *args], input=json.dumps(request) if request else None,
                                  text=True, capture_output=True, cwd=cwd, env=env, timeout=timeout)
            if proc.returncode:
                raise RuntimeError(f'Packaged engine failed ({proc.returncode}): {proc.stderr[-8000:]}\n{proc.stdout[-1000:]}')
            return json.loads(proc.stdout)
        assert run([], {'action':'ping'})['ok']
        assert run(['--check-runtime'])['ok']
        fixture = json.loads((ROOT / 'docs/examples/system-planning.json').read_text())
        report = run([], {'action':'system_planning','study':fixture})
        assert report['engine']['termination'] == 'optimal'
        assert abs(report['summary']['demand_mwh'] - 1205) < 1e-6
        assert report['summary']['max_nodal_balance_error_mw'] < 1e-4
        print('Relocated frozen engine: ping, all action imports and PyPSA/HiGHS solve passed.')


def package(tag, platform):
    full, _, _ = version(tag)
    if platform not in ('darwin-arm64','darwin-amd64','windows-amd64','linux-amd64'):
        raise ValueError('Unsupported release platform.')
    folder = f'Solara-{full}-{platform}'
    dist = ROOT / 'build/release'
    stage = dist / 'stage' / folder
    if stage.exists(): shutil.rmtree(stage)
    stage.mkdir(parents=True)
    if platform.startswith('darwin'):
        shutil.copytree(ROOT/'build/bin/Solara.app', stage/'Solara.app', symlinks=True)
        target = stage/'Solara.app/Contents/Resources/engine'
    else:
        name = 'Solara.exe' if platform.startswith('windows') else 'Solara'
        shutil.copy2(ROOT/'build/bin'/name, stage/name)
        target = stage/'engine'
    if platform.startswith('darwin'):
        from macos_libraries import repair
        repair(ROOT/'build/engine/solara-engine')
    shutil.copytree(ROOT/'build/engine/solara-engine', target, symlinks=True)
    for name in ('README.md','requirements.txt'):
        shutil.copy2(ROOT/name, stage/name)
    shutil.copytree(ROOT/'contract', stage/'contract', ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    shutil.copytree(ROOT/'docs/examples', stage/'examples')
    shutil.copy2(ROOT/'docs/releases.md', stage/'INSTALL.md')
    if platform.startswith('darwin'):
        # PyInstaller signs its native binaries; sign the containing app last.
        subprocess.run(['codesign','--force','--sign','-','--deep',str(stage/'Solara.app')],check=True)
        subprocess.run(['codesign','--verify','--deep','--strict',str(stage/'Solara.app')],check=True)
    assets = dist/'assets'
    assets.mkdir(exist_ok=True)
    if platform.startswith('linux'):
        archive = assets/(folder+'.tar.gz')
        with tarfile.open(archive,'w:gz') as tar: tar.add(stage,arcname=folder)
    elif platform.startswith('darwin'):
        archive = assets/(folder+'.zip')
        subprocess.run(['ditto','-c','-k','--sequesterRsrc','--keepParent',str(stage),str(archive)],check=True)
    else:
        archive = assets/(folder+'.zip')
        with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
            for file in sorted(stage.rglob('*')):
                if file.is_file(): z.write(file,arcname=file.relative_to(stage.parent))
    # Smoke the extracted distribution, so missing files/symlinks fail the job.
    with tempfile.TemporaryDirectory(prefix='solara relocated ') as tmp:
        relocated = Path(tmp)
        if archive.name.endswith('.tar.gz'):
            with tarfile.open(archive) as tar: tar.extractall(relocated,filter='data')
        elif platform.startswith('darwin'):
            subprocess.run(['ditto','-x','-k',str(archive),str(relocated)],check=True)
        else:
            with zipfile.ZipFile(archive) as z: z.extractall(relocated)
        smoke(engine_path(relocated/folder,platform))
    with archive.open('rb') as stream:
        digest = hashlib.file_digest(stream,'sha256').hexdigest()
    archive.with_name(archive.name+'.sha256').write_text(f'{digest}  {archive.name}\n')
    print(archive)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['stamp','package','smoke'])
    parser.add_argument('--tag',default='v0.1.0')
    parser.add_argument('--platform')
    parser.add_argument('--engine',type=Path)
    args = parser.parse_args()
    if args.command == 'stamp': stamp(args.tag)
    elif args.command == 'package': package(args.tag,args.platform)
    else: smoke(args.engine)
