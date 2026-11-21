#!/usr/bin/env python3
"""Retain exact public native-source directions and original build recipes."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('supplier', ROOT / 'acquire-source-evidence.py')
supplier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(supplier)
SOURCES = [
    ('lovell/sharp', '51a990faa26ade5586a4934ac9673c98d8893326', ['LICENSE', 'package.json']),
    ('lovell/sharp-libvips', 'ebb95f8add54eee8bed840e3fb587e4cbec857d7', ['LICENSE', 'README.md', 'build/posix.sh']),
    ('libvips/libvips', '24ad4d042940e6bf99a68871ba886ca8847c9c82', ['LICENSE']),
]


if __name__ == '__main__':
    evidence = {'delivery': 'Company-hosted service; native backend/container copies are not supplied to customers. No local native-library patches or proprietary relink objects.', 'sources': [], 'packages': []}
    for repository, revision, paths in SOURCES:
        tree = supplier.github(f'repos/{repository}/git/trees/{revision}?recursive=1')['tree']
        files = []
        for path in paths:
            entry = next(x for x in tree if x['path'] == path)
            data = supplier.blob(repository, entry)
            destination = ROOT / 'vendor-source/native-build' / repository.split('/')[-1] / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            files.append({'path': path, 'sha256': hashlib.sha256(data).hexdigest()})
        evidence['sources'].append({'repository': 'https://github.com/'+repository, 'revision': revision,
            'sourceArchive': 'https://github.com/'+repository+'/archive/'+revision+'.tar.gz', 'retainedFiles': files})
    for name, version in [('sharp', '0.35.5'), ('@img/sharp-libvips-linux-x64', '1.3.4'), ('@img/sharp-libvips-linuxmusl-x64', '1.3.4')]:
        metadata = json.load(urllib.request.urlopen('https://registry.npmjs.org/'+name+'/'+version, timeout=30))
        evidence['packages'].append({'name': name, 'version': version, 'declaredLicense': metadata.get('license'),
            'archive': metadata['dist']['tarball'], 'integrity': metadata['dist']['integrity']})
    evidence['libvipsSourceRelease'] = {'version': '8.18.7',
        'archive': 'https://github.com/libvips/libvips/releases/download/v8.18.7/vips-8.18.7.tar.xz',
        'publishedChecksum': subprocess.check_output(['gh', 'release', 'download', 'v8.18.7', '--repo', 'libvips/libvips', '--pattern', '*.sha256sum', '--output', '-']).decode().strip()}
    evidence['runtime'] = {'status': 'Candidate build inputs; running mappings require verification after deployment.',
        'api': ['@img/sharp-linux-x64/lib/sharp-linux-x64.node', '@img/sharp-libvips-linux-x64/lib/libvips-cpp.so.8.18.7'],
        'appPortal': 'Both glibc/musl packages are build inputs; candidate runtime mappings have not been measured.'}
    destination = ROOT / 'legal/source-evidence/native.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(evidence, indent=2)+'\n')
    print(json.dumps({'nativeSources': len(evidence['sources']), 'registryIdentities': len(evidence['packages']), 'libvips': '8.18.7'}))
