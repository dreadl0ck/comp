#!/usr/bin/env python3
"""Retain immutable supplier grants and preferred source for the used Dub embeds."""
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parent
REVISION = 'e4d358982c5a5b544495fb18386624ef26c8f16e'


def github(path):
    return json.loads(subprocess.check_output(['gh', 'api', path]))


def blob(repository, entry):
    data = base64.b64decode(github(f"repos/{repository}/git/blobs/{entry['sha']}")['content'])
    if hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest() != entry['sha']:
        raise ValueError('Supplier Git blob mismatch')
    return data


if __name__ == '__main__':
    repository = 'dubinc/dub'
    tree = github(f'repos/{repository}/git/trees/{REVISION}?recursive=1')['tree']
    destination = ROOT / 'vendor-source/dub-embeds'
    evidence = {'repository': 'https://github.com/'+repository, 'revision': REVISION, 'license': 'AGPL-3.0', 'files': [], 'packages': []}
    for entry in tree:
        path = entry['path']
        selected = path == 'LICENSE.md' or path.startswith(('packages/embeds/core/', 'packages/embeds/react/', 'packages/tsconfig/'))
        if not selected or entry['type'] != 'blob': continue
        if any(part in {'ee', '(ee)', 'node_modules'} or part.startswith('.env') for part in Path(path).parts):
            raise ValueError('Unexpected supplier scope: '+path)
        data = blob(repository, entry)
        target = destination / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        evidence['files'].append({'path': path, 'sha256': hashlib.sha256(data).hexdigest(), 'gitBlob': entry['sha']})
    license_text = (destination / 'LICENSE.md').read_text()
    if 'Content outside of the above mentioned directories' not in license_text or 'GNU AFFERO GENERAL PUBLIC LICENSE' not in license_text:
        raise ValueError('Unexpected supplier license scope')
    for name in ['core', 'react']:
        package = '@dub/embed-'+name
        metadata = json.load(urllib.request.urlopen('https://registry.npmjs.org/'+package+'/0.0.16', timeout=30))
        if metadata.get('gitHead') != REVISION: raise ValueError('Published source revision changed')
        source_version = json.loads((destination / 'packages/embeds' / name / 'package.json').read_text())['version']
        evidence['packages'].append({'name': package, 'version': '0.0.16', 'publishedGitHead': REVISION, 'sourcePackageVersion': source_version, 'integrity': metadata['dist']['integrity'], 'archive': metadata['dist']['tarball']})
    path = ROOT / 'legal/source-evidence/dub-embeds.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(evidence, indent=2)+'\n')
    print(json.dumps({'retainedFiles': len(evidence['files']), 'publishedPackages': len(evidence['packages']), 'revision': REVISION}))
