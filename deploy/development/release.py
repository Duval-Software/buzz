#!/usr/bin/env python3
"""Restricted SSH receiver: deploy a checked bundle, roll back, or report status.

Installed by an operator, never replaced by the uploaded bundle. No production
paths, schema writes, arbitrary shell commands, or Docker arguments are accepted.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path("/opt/creatorhive-preview")
FILES = {"buzz-relay", "release.json"}


def run(*args, **kwargs):
    return subprocess.check_output(args, cwd=ROOT, text=True, **kwargs).strip()


def read_bundle(stream, destination):
    """Reject traversal, links, duplicate files and oversized archives before use."""
    seen = set()
    with tarfile.open(fileobj=stream, mode="r|gz") as archive:
        for member in archive:
            if member.name not in FILES or member.name in seen or not member.isfile() or member.size > 300_000_000:
                raise ValueError("Unexpected release archive entry")
            seen.add(member.name)
            with archive.extractfile(member) as source, (destination / member.name).open("wb") as output:
                shutil.copyfileobj(source, output)
    if seen != FILES:
        raise ValueError("Incomplete release archive")
    manifest = json.loads((destination / "release.json").read_text())
    if not re.fullmatch(r"[a-f0-9]{40}", manifest["id"]) or manifest["relayCommit"] != manifest["id"]:
        raise ValueError("Expected immutable relay commit")
    if not re.fullmatch(r"[a-f0-9]{40}", manifest["keeperCommit"]) or manifest["environment"] != "development":
        raise ValueError("Expected development keeper commit")
    for name in FILES - {"release.json"}:
        if hashlib.sha256((destination / name).read_bytes()).hexdigest() != manifest["binaries"][name]:
            raise ValueError(f"Checksum mismatch: {name}")
        (destination / name).chmod(0o755)
    return manifest


def verify_database(manifest):
    query = "select version || ':' || case when success then encode(checksum,'hex') else 'FAILED' end from buzz._sqlx_migrations order by version"
    rows = run("docker", "run", "--rm", "--network", "host", "--env-file", str(ROOT / "relay-database.env"),
               "-v", f"{ROOT}/certs:{ROOT}/certs:ro", "postgres:17-alpine", "sh", "-ec",
               'psql "$DATABASE_URL" -XAt -v ON_ERROR_STOP=1 -c "$1"', "sh", query)
    actual = dict(row.split(":", 1) for row in rows.splitlines())
    expected = {str(row["version"]): row["checksum"] for row in manifest["migrations"]}
    if actual != expected:
        raise ValueError("Database migration versions/checksums differ; apply reviewed migrations before deploying")


def compose(*args):
    run("docker", "compose", "--project-directory", str(ROOT), "--env-file", ".env", "--env-file", "runtime.env", "--env-file", "release.env",
        "-f", "compose.yml", "-f", "development.compose.yml", *args)


def healthy(release_id):
    checks = [("http://127.0.0.1:3300/health", 200), ("http://127.0.0.1:8092/keeper/health", 200),
              ("http://127.0.0.1:8092/keeper/agents", 401)]
    for url, expected in checks:
        try:
            response = urllib.request.urlopen(url, timeout=5)
            status = response.status
            response.close()
        except urllib.error.HTTPError as error:
            status = error.code
        if status != expected:
            return False
    # Readiness checks the database and Redis, not just a running HTTP listener.
    container = run("docker", "inspect", "--format", "{{.State.Health.Status}}", "creatorhive-preview-relay-1")
    with urllib.request.urlopen("http://127.0.0.1:3300/assets/release.json", timeout=5) as response:
        return container == "healthy" and json.load(response)["id"] == release_id


def activate(release_id):
    (ROOT / "release.env").write_text(f"RELEASE_ID={release_id}\n")
    compose("up", "-d", "--no-deps", "relay", "agentkeeper")
    for _ in range(30):
        try:
            if healthy(release_id):
                return
        except (OSError, ValueError):
            pass
        time.sleep(2)
    raise RuntimeError("Release failed readiness checks")


def main():
    command = os.environ.get("SSH_ORIGINAL_COMMAND", " ".join(sys.argv[1:])).split()
    if command == ["status"]:
        print((ROOT / "current.json").read_text())
        return
    if command != ["deploy"] and not (len(command) == 2 and command[0] == "rollback" and re.fullmatch(r"[a-z0-9-]{7,64}", command[1])):
        raise ValueError("Allowed commands: deploy, status, rollback RELEASE_ID")
    with (ROOT / "release.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        old = json.loads((ROOT / "current.json").read_text())
        if command[0] == "deploy":
            with tempfile.TemporaryDirectory(dir=ROOT) as temp:
                staging = Path(temp)
                manifest = read_bundle(sys.stdin.buffer, staging)
                expected_config = hashlib.sha256((ROOT / "development.compose.yml").read_bytes()).hexdigest()
                if manifest["configuration"] != expected_config:
                    raise ValueError("Install the reviewed Compose configuration before this release")
                verify_database(manifest)
                keeper_hash = manifest["binaries"]["agentkeeper"]
                if not re.fullmatch(r"[a-f0-9]{64}", keeper_hash):
                    raise ValueError("Invalid keeper checksum")
                keeper = ROOT / "keepers" / keeper_hash
                if hashlib.sha256(keeper.read_bytes()).hexdigest() != keeper_hash:
                    raise ValueError("Install the pinned keeper artifact before this release")
                shutil.copy2(keeper, staging / "agentkeeper")
                destination = ROOT / "releases" / manifest["id"]
                if destination.exists():
                    existing = json.loads((destination / "release.json").read_text())
                    if existing != manifest:
                        raise ValueError("Release already exists with different contents; use rollback to activate it")
                else:
                    (staging / "public/assets").mkdir(parents=True)
                    shutil.copy2(staging / "release.json", staging / "public/assets/release.json")
                    (staging / "public/index.html").write_text("<!doctype html><title>CreatorHive API</title>CreatorHive development API")
                    shutil.copytree(staging, destination)
        else:
            destination = ROOT / "releases" / command[1]
            manifest = json.loads((destination / "release.json").read_text())
            verify_database(manifest)
        try:
            activate(manifest["id"])
        except Exception:
            activate(old["id"])
            raise
        (ROOT / "previous.json").write_text(json.dumps(old, indent=2) + "\n")
        (ROOT / "current.json").write_text(json.dumps(manifest, indent=2) + "\n")
        print(json.dumps({"release": manifest["id"], "previous": old["id"], "status": "healthy"}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Deployment stopped: {error}", file=sys.stderr)
        sys.exit(1)
