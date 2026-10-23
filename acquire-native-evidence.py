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
    ('lovell/sharp', 'e0624568686516209c434de2d3c0ef6688f0811d', ['LICENSE', 'package.json']),
    ('lovell/sharp-libvips', '20b5e899954907a3039d6e3d4c200aaa0ec52c4c', ['LICENSE', 'README.md', 'build/posix.sh']),
    ('libvips/libvips', '0c9151a4f416d2f8ae20a755db218f6637050eec', ['LICENSE']),
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
    for name, version in [('sharp', '0.34.5'), ('@img/sharp-libvips-linux-x64', '1.2.4'), ('@img/sharp-libvips-linuxmusl-x64', '1.2.4')]:
        metadata = json.load(urllib.request.urlopen('https://registry.npmjs.org/'+name+'/'+version, timeout=30))
        evidence['packages'].append({'name': name, 'version': version, 'declaredLicense': metadata.get('license'),
            'archive': metadata['dist']['tarball'], 'integrity': metadata['dist']['integrity']})
    evidence['libvipsSourceRelease'] = {'version': '8.17.3',
        'archive': 'https://github.com/libvips/libvips/releases/download/v8.17.3/vips-8.17.3.tar.xz',
        'publishedChecksum': subprocess.check_output(['gh', 'release', 'download', 'v8.17.3', '--repo', 'libvips/libvips', '--pattern', '*.sha256sum', '--output', '-']).decode().strip()}
    evidence['runtime'] = {'api': ['@img/sharp-linux-x64/lib/sharp-linux-x64.node', '@img/sharp-libvips-linux-x64/lib/libvips-cpp.so.8.17.3'],
        'appPortal': 'Both glibc/musl packages present; no mapping observed during inspection, lazy use possible.'}
    destination = ROOT / 'legal/source-evidence/native.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(evidence, indent=2)+'\n')
    print(json.dumps({'nativeSources': len(evidence['sources']), 'registryIdentities': len(evidence['packages']), 'libvips': '8.17.3'}))
