#!/usr/bin/env python3
"""Generate profile locks with the pinned builder, leaving release builds frozen."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
output = Path(sys.argv[1]).resolve()
output.mkdir(parents=True, exist_ok=False)
for profile, name in [('app', 'Dockerfile'), ('api', 'apps/api/Dockerfile.multistage')]:
    text = (ROOT / name).read_text()
    copy = 'COPY build-locks/'+profile+'.bun.lock ./bun.lock\n'
    if text.count(copy) != 1 or text.count('--ignore-scripts --frozen-lockfile') != 1:
        raise ValueError('Build recipe changed; inspect profile-lock generation')
    text = text.replace(copy, '').replace('--ignore-scripts --frozen-lockfile', '--ignore-scripts')
    dockerfile = output / (profile+'.Dockerfile')
    dockerfile.write_text(text)
    subprocess.run(['docker', 'build', '--platform=linux/amd64', '-f', str(dockerfile),
        '--target', 'dependency-lock', '--output', 'type=local,dest='+str(output/profile), str(ROOT)], check=True)
subprocess.run(['python3', str(ROOT/'record-build-locks.py'), str(output/'app/bun.lock'), str(output/'api/bun.lock')], check=True)
