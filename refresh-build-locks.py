#!/usr/bin/env python3
"""Prune workspace membership from the reviewed root lock; validate with pinned Bun."""
import copy
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
IMAGE = 'oven/bun:1.4.5@sha256:3aa040e5445efa09d75bb428a64ba50db13e2b3ac9b6b0c7f145615f62b2ee18'


def main():
    output = Path(sys.argv[1]).resolve()
    output.mkdir(parents=True, exist_ok=False)
    spec = importlib.util.spec_from_file_location('record_locks', ROOT / 'record-build-locks.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    original = helper.parse_lock((ROOT / 'bun.lock').read_bytes())
    for profile, filename in [('app', 'Dockerfile'), ('api', 'apps/api/Dockerfile.multistage')]:
        recipe = (ROOT / filename).read_text().split('FROM scratch AS dependency-lock')[0]
        if '--ignore-scripts --frozen-lockfile' not in recipe:
            raise ValueError('Release dependency install must remain frozen')
        manifests = ['package.json', *re.findall(r'^COPY ((?:packages|apps)/\S+/package\.json) ', recipe, re.M)]
        locations = {str(Path(file).parent) if '/' in file else '' for file in manifests}
        lock = copy.deepcopy(original)
        lock['workspaces'] = {key: copy.deepcopy(original['workspaces'][key]) for key in sorted(locations)}
        directory = output / profile
        directory.mkdir()
        for filename in manifests:
            file = ROOT / filename
            if not file.resolve().is_relative_to(ROOT):
                raise ValueError('Manifest escapes source root')
            package = json.loads(file.read_text())
            if profile == 'api' and filename == 'package.json':
                if 'delete pkg.dependencies; delete pkg.devDependencies; delete pkg.scripts;' not in recipe:
                    raise ValueError('Inspect changed API manifest transformation')
                for key in ('dependencies', 'devDependencies', 'scripts'):
                    package.pop(key, None)
                for key in ('dependencies', 'devDependencies', 'optionalDependencies'):
                    lock['workspaces'][''].pop(key, None)
            target = directory / filename
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(package, indent=2) + '\n')
        lock['packages'] = {key: value for key, value in lock['packages'].items()
                            if '@workspace:' not in value[0] or value[0].split('@workspace:', 1)[1] in locations}
        (directory / 'bun.lock').write_text(json.dumps(lock, indent=2) + '\n')
        command = ('bun --no-env-file install --linker=hoisted --ignore-scripts --lockfile-only && '
                   'bun --no-env-file install --linker=hoisted --ignore-scripts --frozen-lockfile --lockfile-only')
        subprocess.run(['docker', 'run', '--rm', '--platform=linux/amd64', '--network=none', '--read-only',
                        '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128',
                        '--memory=2g', '--cpus=2', '--tmpfs', '/tmp:rw,size=512m', '-e', 'HOME=/tmp',
                        '-v', str(directory) + ':/app', '-w', '/app', IMAGE, 'sh', '-ec', command],
                       check=True, timeout=90)
    subprocess.run([sys.executable, str(ROOT / 'record-build-locks.py'),
                    str(output / 'app/bun.lock'), str(output / 'api/bun.lock')], check=True)


if __name__ == '__main__':
    main()
