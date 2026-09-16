"""Runnable archive-boundary and readiness checks; no live services."""
import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
from unittest.mock import patch

import release


def archive(entries):
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode="w:gz") as output:
        for name, contents in entries:
            entry = tarfile.TarInfo(name)
            entry.size = len(contents)
            output.addfile(entry, io.BytesIO(contents))
    data.seek(0)
    return data


with tempfile.TemporaryDirectory() as temp:
    directory = Path(temp)
    manifest = {"id": "a" * 40, "relayCommit": "a" * 40, "keeperCommit": "b" * 40, "environment": "development",
                "binaries": {"buzz-relay": hashlib.sha256(b"relay").hexdigest()}}
    valid = [("release.json", json.dumps(manifest).encode()), ("buzz-relay", b"relay")]
    assert release.read_bundle(archive(valid), directory) == manifest
    for entries in [valid + [("../escape", b"x")], valid + [valid[1]], valid[:1], [valid[0], ("buzz-relay", b"changed")]]:
        try:
            release.read_bundle(archive(entries), directory)
            raise AssertionError("Unsafe archive accepted")
        except ValueError:
            pass
    with patch.object(release, "ROOT", directory), patch.object(release, "compose") as compose, patch.object(release, "healthy", side_effect=[False, True]), patch.object(release.time, "sleep"):
        release.activate("a" * 40)
        assert (directory / "release.env").read_text() == "RELEASE_ID=" + "a" * 40 + "\n"
        compose.assert_called_once_with("a" * 40, "up", "-d", "--no-deps", "relay", "agentkeeper")
    old = {"id": "baseline"}
    (directory / "current.json").write_text(json.dumps(old))
    target = directory / "releases" / manifest["id"]
    target.mkdir(parents=True)
    (target / "compose.yml").write_bytes(b"configuration")
    manifest["configuration"] = hashlib.sha256(b"configuration").hexdigest()
    (target / "release.json").write_text(json.dumps(manifest))
    (target / "buzz-relay").write_bytes(b"relay")
    with patch.object(release, "ROOT", directory), patch.dict(release.os.environ, {"SSH_ORIGINAL_COMMAND": "rollback " + manifest["id"]}), patch.object(release, "verify_database"), patch.object(release, "activate", side_effect=[RuntimeError("failed readiness"), None]) as activate:
        try:
            release.main()
            raise AssertionError("Failed release accepted")
        except RuntimeError:
            pass
        assert [call.args for call in activate.call_args_list] == [(manifest["id"],), ("baseline",)]
        assert json.loads((directory / "current.json").read_text()) == old
print("Release archive validation and readiness retry checks passed.")
