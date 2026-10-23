#!/usr/bin/env python3
"""Record the Docker build's pruned locks without upgrading registry packages."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent


def parse_lock(data):
    text = data.decode()
    result = []
    quoted = escaped = False
    for i, char in enumerate(text):
        if quoted:
            result.append(char)
            if escaped: escaped = False
            elif char == '\\': escaped = True
            elif char == '"': quoted = False
        elif char == '"':
            quoted = True
            result.append(char)
        elif char != ',' or text[i+1:].lstrip()[:1] not in {']', '}'}:
            result.append(char)
    return json.loads(''.join(result))


def registry_packages(lock):
    return {v[0]: v for v in lock['packages'].values() if '@workspace:' not in v[0]}


if __name__ == '__main__':
    original = registry_packages(parse_lock((ROOT / 'bun.lock').read_bytes()))
    out = ROOT / 'build-locks'
    out.mkdir(exist_ok=True)
    receipt = {}
    for name, arg in zip(['app', 'api'], sys.argv[1:], strict=True):
        raw = Path(arg).read_bytes()
        packages = registry_packages(parse_lock(raw))
        added = set(packages) - set(original)
        if added: raise ValueError('Unreviewed resolved versions: '+str(sorted(added)))
        if any(v[-1] != original[k][-1] for k, v in packages.items()):
            raise ValueError('Registry integrity changed')
        (out / (name+'.bun.lock')).write_bytes(raw)
        receipt[name] = {'sha256': hashlib.sha256(raw).hexdigest(), 'packages': len(packages), 'newVersions': 0}
    (out / 'receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
    print(json.dumps(receipt))
