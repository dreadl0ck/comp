#!/usr/bin/env python3
"""Import the reviewed Inter bytes and original terms into deployed frontends."""
import hashlib
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parent
supplier = Path(sys.argv[1]).resolve()
record = next(x for x in json.loads((supplier / 'legal/extras.json').read_text()) if x['name'] == 'inter')
font = (supplier / 'frontend/src/fonts/Inter.woff2').read_bytes()
assert hashlib.sha256(font).hexdigest() == '2dcd3612039a9aaa2660c0c9edd0f4b982e19d317af5ffe4161c37ddc803b5d0'
for doc in record['documents']:
    assert hashlib.sha256(doc['text'].encode()).hexdigest() == doc['sha256']
license_text = next(x['text'] for x in record['documents'] if x['path'] == 'OFL.txt')
for app in ['app', 'portal']:
    directory = root / 'apps' / app / 'public/fonts'
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'Inter.woff2').write_bytes(font)
    (directory / 'Inter-OFL.txt').write_text(license_text)
    (directory / 'Inter-provenance.json').write_text(json.dumps(record, indent=2)+'\n')
print('Both frontends have the unchanged Inter asset and complete original OFL terms')
