#!/usr/bin/env python3
"""Deterministic committed-source export; deployment files are never read."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parent
DIRS = {"apps", "packages", "scripts", "patches"}
FILES = {"LICENSE", "README.md", "Dockerfile", "docker-compose.dokploy.yml", ".dockerignore",
         "package.json", "bun.lock", "turbo.json", "tsconfig.json", "package-source.py",
         "SOURCE-BUILD.md", "source-compose.yml"}
FORBIDDEN = {"node_modules", ".git", ".next", "dist", "coverage", "test-results", ".turbo",
             "playwright-report", "logs", "uploads", "backups", "__pycache__"}


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args])


def check(name, mode, data):
    parts = Path(name).parts
    if mode not in {"100644", "100755"} or any(x in FORBIDDEN or x.startswith(".env") for x in parts):
        raise ValueError("Forbidden source member: " + name)
    if name.endswith((".sql.gz", ".dump", ".pem", ".key", ".p12", ".pfx")):
        raise ValueError("Credential/data candidate: " + name)
    if re.search(rb"-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----\s+[A-Za-z0-9+/=]{32,}|(?:sk-ant-api|sk-ant-oat|ghp_)[A-Za-z0-9_-]{20,}", data):
        raise ValueError("Secret candidate: " + name)


def package(revision, output):
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
                "apps/api/Dockerfile.multistage", "packages/db/package.json"}
    if not required <= names:
        raise ValueError("Missing build material: " + str(required - names))
    output.mkdir(parents=True, exist_ok=True)
    archive = output / (revision + ".tar.gz")
    with archive.open("wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as zipped:
        with tarfile.open(fileobj=zipped, mode="w", format=tarfile.PAX_FORMAT) as tar:
            for name, mode, data in sorted(members):
                item = tarfile.TarInfo("comp-" + revision + "/" + name)
                item.size, item.mode, item.mtime = len(data), int(mode[-3:], 8), 0
                tar.addfile(item, io.BytesIO(data))
    manifest = {"revision": revision, "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
                "archive": "/legal/source/" + archive.name, "license": "AGPL-3.0",
                "files": len(members), "scope": "Exact modified Comp fork, workspace packages, locks, schemas/migrations, build/install scripts and configuration templates. No production environments, evidence or user records."}
    (output / (revision + ".json")).write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("revision")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    package(args.revision, args.output.resolve())
