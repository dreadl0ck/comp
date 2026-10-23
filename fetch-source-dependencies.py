#!/usr/bin/env python3
"""Acquire exact locked registry packages by published SRI, without installation."""
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import http.client
import importlib.util
import json
from pathlib import Path
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('locks', ROOT / 'record-build-locks.py')
locks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(locks)


def acquire(item):
    identity, record = item
    name, version = identity.rsplit('@', 1)
    sri = next((x for x in reversed(record) if isinstance(x, str) and x.startswith('sha512-')), None)
    if not sri: raise ValueError('No SHA512 registry proof: '+identity)
    filename = hashlib.sha256(identity.encode()).hexdigest()+'.tgz'
    path = output / filename
    url = 'https://registry.npmjs.org/'+urllib.parse.quote(name, safe='@/')+'/-/'+name.split('/')[-1]+'-'+version+'.tgz'
    if path.exists():
        raw = path.read_bytes()
    else:
        for attempt in range(3):
            try:
                raw = urllib.request.urlopen(url, timeout=90).read()
                break
            except (http.client.IncompleteRead, urllib.error.URLError, TimeoutError):
                if attempt == 2: raise
                time.sleep(attempt+1)
    if base64.b64encode(hashlib.sha512(raw).digest()).decode() != sri.removeprefix('sha512-'):
        raise ValueError('Registry SRI mismatch: '+identity)
    path.write_bytes(raw)
    return {'identity': identity, 'url': url, 'sri': sri, 'file': filename, 'sha256': hashlib.sha256(raw).hexdigest()}


if __name__ == '__main__':
    output = Path(sys.argv[1]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    packages = {}
    for name in ['app', 'api']:
        packages.update(locks.registry_packages(locks.parse_lock((ROOT / 'build-locks' / (name+'.bun.lock')).read_bytes())))
    with ThreadPoolExecutor(max_workers=12) as pool:
        records = sorted(pool.map(acquire, sorted(packages.items())), key=lambda x: x['identity'])
    (output / 'index.json').write_text(json.dumps(records, indent=2)+'\n')
    print(json.dumps({'packages': len(records), 'bytes': sum((output / x['file']).stat().st_size for x in records)}))
