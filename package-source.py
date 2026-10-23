#!/usr/bin/env python3
"""Deterministic committed-source export; deployment files are never read."""
import argparse
import base64
import gzip
import hashlib
import io
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parent
DIRS = {"apps", "packages", "scripts", "patches", "build-locks"}
FILES = {"LICENSE", "README.md", "Dockerfile", "docker-compose.dokploy.yml", ".dockerignore",
         "package.json", "bun.lock", "turbo.json", "tsconfig.json", "package-source.py",
         "SOURCE-BUILD.md", "source-compose.yml", "record-build-locks.py", "fetch-source-dependencies.py", "test-package-source.py", "source-dependency-review.json"}
FORBIDDEN = {"node_modules", ".git", ".next", "dist", "coverage", "test-results", ".turbo",
             "playwright-report", "__pycache__"}


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args])


def check(name, mode, data):
    parts = Path(name).parts
    if name.startswith(('apps/api/uploads/', 'apps/api/logs/', 'apps/api/backups/', 'apps/app/uploads/')):
        raise ValueError("Runtime data: " + name)
    if mode not in {"100644", "100755"} or any(x in FORBIDDEN or x.startswith(".env") for x in parts):
        raise ValueError("Forbidden source member: " + name)
    if name.endswith((".sql.gz", ".dump", ".pem", ".key", ".p12", ".pfx")):
        raise ValueError("Credential/data candidate: " + name)
    if re.search(rb"-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----\s+[A-Za-z0-9+/=]{32,}|(?:sk-ant-api|sk-ant-oat|ghp_)[A-Za-z0-9_-]{20,}", data):
        raise ValueError("Secret candidate: " + name)


def require_dependency_review(index, review):
    if review.get('clearForBundling') is not True:
        raise ValueError('Dependency source/redistribution review is incomplete; source publication blocked')
    decisions = review.get('reviewed', {})
    for entry in index:
        decision = decisions.get(entry['identity'], {})
        if decision.get('archiveSHA256') != entry['sha256'] or decision.get('redistributionAllowed') is not True or not decision.get('license') or not decision.get('evidenceSHA256'):
            raise ValueError('Unreviewed supplier package: '+entry['identity'])


def package(revision, output, dependencies):
    revision = git("rev-parse", "--verify", revision + "^{commit}").decode().strip()
    members = []
    for entry in filter(None, git("ls-tree", "-rz", "--full-tree", revision).split(b"\0")):
        meta, name = entry.split(b"\t", 1)
        name = name.decode()
        if name.split("/")[0] not in DIRS and name not in FILES:
            continue
        mode, kind, oid = meta.decode().split()
        # Examples of environment configuration are supplied in SOURCE-BUILD.md.
        if any(p.startswith(".env") for p in Path(name).parts):
            continue
        data = git("cat-file", "blob", oid) if kind == "blob" else b""
        check(name, mode, data)
        members.append((name, mode, data))
    names = {m[0] for m in members}
    required = {"LICENSE", "bun.lock", "package.json", "Dockerfile", "SOURCE-BUILD.md",
                "apps/api/Dockerfile.multistage", "packages/db/package.json", "build-locks/app.bun.lock", "build-locks/api.bun.lock"}
    if not required <= names:
        raise ValueError("Missing build material: " + str(required - names))
    spec = importlib.util.spec_from_file_location('locks', ROOT / 'record-build-locks.py')
    locks = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(locks)
    expected = {}
    for name, _, data in members:
        if name in {'build-locks/app.bun.lock', 'build-locks/api.bun.lock'}:
            expected.update(locks.registry_packages(locks.parse_lock(data)))
    index_raw = (dependencies / 'index.json').read_bytes()
    index = json.loads(index_raw)
    review = next((json.loads(data) for name, _, data in members if name == 'source-dependency-review.json'), {})
    require_dependency_review(index, review)
    if {x['identity'] for x in index} != set(expected):
        raise ValueError('Dependency archive set differs from committed build locks')
    for entry in index:
        if not re.fullmatch('[0-9a-f]{64}\\.tgz', entry['file']):
            raise ValueError('Unsafe dependency filename')
        sri = next(x for x in reversed(expected[entry['identity']]) if isinstance(x, str) and x.startswith('sha512-'))
        if entry['sri'] != sri: raise ValueError('Dependency SRI identity changed')
    members.append(('dependency-packages/index.json', '100644', index_raw))
    output.mkdir(parents=True, exist_ok=True)
    archive = output / (revision + ".tar.gz")
    with archive.open("wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as zipped:
        with tarfile.open(fileobj=zipped, mode="w", format=tarfile.PAX_FORMAT) as tar:
            for name, mode, data in sorted(members):
                item = tarfile.TarInfo("comp-" + revision + "/" + name)
                item.size, item.mode, item.mtime = len(data), int(mode[-3:], 8), 0
                tar.addfile(item, io.BytesIO(data))
            for entry in index:
                data = (dependencies / entry['file']).read_bytes()
                if base64.b64encode(hashlib.sha512(data).digest()).decode() != entry['sri'].removeprefix('sha512-'):
                    raise ValueError('Dependency bytes changed: '+entry['identity'])
                item = tarfile.TarInfo('comp-'+revision+'/dependency-packages/'+entry['file'])
                item.size, item.mode, item.mtime = len(data), 0o644, 0
                tar.addfile(item, io.BytesIO(data))
    with archive.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    manifest = {"revision": revision, "sha256": digest,
                "archive": "/legal/source/" + archive.name, "license": "AGPL-3.0",
                "files": len(members)+len(index), "registryPackages": len(index), "scope": "Exact modified Comp fork, workspace packages, frozen profile locks, original SRI-verified registry packages, schemas/migrations, build/install scripts and configuration templates. Supplier terms remain separate. No production environments, evidence or user records."}
    (output / (revision + ".json")).write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("revision")
    parser.add_argument("output", type=Path)
    parser.add_argument('--dependencies', type=Path, required=True)
    args = parser.parse_args()
    package(args.revision, args.output.resolve(), args.dependencies.resolve())
