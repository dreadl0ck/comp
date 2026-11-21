#!/usr/bin/env python3
"""Export the committed deployed Comp work, covered Dub source and build inputs."""
import argparse
import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parent
APPS = {'app', 'api', 'portal'}
PACKAGES = {'analytics', 'auth', 'billing', 'company', 'db', 'email', 'integration-platform',
            'integrations', 'kv', 'tsconfig', 'ui', 'utils'}
FILES = {'LICENSE', 'README.md', 'Dockerfile', 'docker-compose.dokploy.yml', '.dockerignore', '.gitattributes',
         'package.json', 'bun.lock', 'turbo.json', 'tsconfig.json', 'package-source.py',
         'SOURCE-BUILD.md', 'source-compose.yml', 'record-build-locks.py', 'test-package-source.py',
         'source-scope.json', 'acquire-source-evidence.py', 'acquire-native-evidence.py', 'sync-source-fonts.py', 'refresh-build-locks.py', 'packages/docs/openapi.json'}
FORBIDDEN = {'node_modules', '.git', '.next', 'dist', 'coverage', 'test-results', '.turbo',
             'playwright-report', '__pycache__', 'ee', '(ee)'}


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])


def selected(name):
    p = Path(name).parts
    if any(x.startswith('.env') or x in FORBIDDEN for x in p): return False
    return name in FILES or (len(p) > 2 and p[0] == 'apps' and p[1] in APPS) or \
        (len(p) > 2 and p[0] == 'packages' and p[1] in PACKAGES) or \
        p[0] in {'scripts', 'patches', 'build-locks', 'vendor-source', 'legal'}


def check(name, mode, data):
    parts = Path(name).parts
    if name.startswith(('apps/api/uploads/', 'apps/api/logs/', 'apps/api/backups/', 'apps/app/uploads/')):
        raise ValueError('Runtime data: '+name)
    if mode not in {'100644', '100755'} or any(x in FORBIDDEN or x.startswith('.env') for x in parts):
        raise ValueError('Forbidden source member: '+name)
    if name.endswith(('.sql.gz', '.dump', '.pem', '.key', '.p12', '.pfx')):
        raise ValueError('Credential/data candidate: '+name)
    if re.search(rb'-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----\s+[A-Za-z0-9+/=]{32,}|(?:sk-ant-api|sk-ant-oat|ghp_)[A-Za-z0-9_-]{20,}', data):
        raise ValueError('Secret candidate: '+name)


def dependency_directions(locks):
    spec = importlib.util.spec_from_file_location('locks', ROOT / 'record-build-locks.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    records = {}
    for profile, data in locks.items():
        parsed = helper.parse_lock(data)
        if parsed.get('patchedDependencies'):
            raise ValueError('Locally modified dependencies need their patches/source included')
        for identity, record in helper.registry_packages(parsed).items():
            integrity = next((x for x in reversed(record) if isinstance(x, str) and x.startswith('sha512-')), None)
            if not integrity: raise ValueError('Build input lacks public integrity proof: '+identity)
            name, version = identity.rsplit('@', 1)
            entry = records.setdefault(identity, {'identity': identity, 'profiles': [], 'integrity': integrity,
                'archive': 'https://registry.npmjs.org/'+name+'/-/'+name.split('/')[-1]+'-'+version+'.tgz'})
            if entry['integrity'] != integrity:
                raise ValueError('Profile integrity mismatch: '+identity)
            entry['profiles'].append(profile)
    return {'scope': 'Frozen build inputs, including optional/build-only candidates; not a claim that every input is shipped. Original unmodified packages remain available from their publishers under their own terms. Covered Dub preferred source is retained in vendor-source.',
            'packages': [records[k] for k in sorted(records)]}


def package(revision, output):
    revision = git('rev-parse', '--verify', revision+'^{commit}').decode().strip()
    if git('show', revision+':package-source.py') != Path(__file__).read_bytes():
        raise ValueError('Use the packager committed at the requested revision')
    entries = []
    for entry in filter(None, git('ls-tree', '-rz', '--full-tree', revision).split(b'\0')):
        meta, raw_name = entry.split(b'\t', 1)
        name = raw_name.decode()
        if not selected(name): continue
        mode, kind, oid = meta.decode().split()
        if kind != 'blob': raise ValueError('Non-file source member: '+name)
        entries.append((name, mode, oid))
    blobs = io.BytesIO(subprocess.check_output(['git', '-C', str(ROOT), 'cat-file', '--batch'],
        input=b''.join((oid+'\n').encode() for _, _, oid in entries)))
    members = []
    for name, mode, oid in entries:
        got, kind, size = blobs.readline().decode().split()
        if got != oid or kind != 'blob': raise ValueError('Source blob identity mismatch')
        data = blobs.read(int(size))
        if blobs.read(1) != b'\n': raise ValueError('Malformed source blob stream')
        check(name, mode, data)
        members.append((name, mode, data))
    by_name = {name: data for name, _, data in members}
    required = {'LICENSE', 'package.json', 'bun.lock', 'Dockerfile', 'apps/api/Dockerfile.multistage',
        'apps/app/src/app/layout.tsx', 'apps/api/src/main.ts', 'apps/portal/src/app/layout.tsx',
        'build-locks/app.bun.lock', 'build-locks/api.bun.lock', 'source-scope.json',
        'SOURCE-BUILD.md', 'vendor-source/dub-embeds/LICENSE.md', 'legal/source-evidence/dub-embeds.json', 'legal/source-evidence/native.json'}
    if not required <= by_name.keys(): raise ValueError('Missing source/build material: '+str(required-by_name.keys()))
    evidence = json.loads(by_name['legal/source-evidence/dub-embeds.json'])
    for item in evidence['files']:
        name = 'vendor-source/dub-embeds/'+item['path']
        if hashlib.sha256(by_name[name]).hexdigest() != item['sha256']:
            raise ValueError('Covered supplier source changed: '+name)
    native = json.loads(by_name['legal/source-evidence/native.json'])
    for source in native['sources']:
        for item in source['retainedFiles']:
            name = 'vendor-source/native-build/'+source['repository'].rsplit('/', 1)[-1]+'/'+item['path']
            if hashlib.sha256(by_name[name]).hexdigest() != item['sha256']:
                raise ValueError('Native source reference changed: '+name)
    directions = dependency_directions({p: by_name['build-locks/'+p+'.bun.lock'] for p in ['app', 'api']})
    members.append(('DEPENDENCY-SOURCES.json', '100644', (json.dumps(directions, indent=2)+'\n').encode()))
    identity = {'revision': revision, 'modifiedBy': 'Amsterdam Technologies',
                'modifiedAt': git('show', '-s', '--format=%cI', revision).decode().strip()}
    members.append(('SOURCE-REVISION.json', '100644', (json.dumps(identity, indent=2)+'\n').encode()))
    output.mkdir(parents=True, exist_ok=True)
    archive = output / (revision+'.tar.gz')
    with archive.open('wb') as raw, gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as zipped:
        with tarfile.open(fileobj=zipped, mode='w', format=tarfile.PAX_FORMAT) as tar:
            for name, mode, data in sorted(members):
                item = tarfile.TarInfo('comp-'+revision+'/'+name)
                item.size, item.mode, item.mtime = len(data), int(mode[-3:], 8), 0
                tar.addfile(item, io.BytesIO(data))
    with archive.open('rb') as stream: digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    manifest = {'revision': revision, 'sha256': digest, 'archive': '/legal/source/'+archive.name,
        'license': 'AGPL-3.0', 'files': len(members), 'registryBuildInputs': len(directions['packages']),
        'scope': 'Modified Comp app/API/portal, required workspace source, covered Dub source, original licenses, frozen build inputs, scripts and safe configuration templates. No registry binary superset, production environments or customer records.'}
    (output / (revision+'.json')).write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps(manifest))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('revision')
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    package(args.revision, args.output.resolve())
