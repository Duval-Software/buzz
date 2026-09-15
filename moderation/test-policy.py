"""Run with python3 moderation/test-policy.py; no services required."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from build_policy import compile_policy

community = "00000000-0000-0000-0000-000000000032"
compile_policy(Path(__file__).with_name("blocked-words.json"), community)
with TemporaryDirectory() as directory:
    path = Path(directory) / "policy.json"
    path.write_text(json.dumps({"version": 1, "terms": [" TESTBLOCKED ", "kill   yourself"]}))
    canonical = compile_policy(path, community)
    path.write_text(json.dumps({"version": 1, "terms": ["kill yourself", "testblocked"]}))
    assert compile_policy(path, community) == canonical
    for terms in [[], [".*"], ["testblocked", "ＴＥＳＴＢＬＯＣＫＥＤ"], [42], ["a"], ["a" * 101]]:
        path.write_text(json.dumps({"version": 1, "terms": terms}))
        try:
            compile_policy(path, community)
        except ValueError:
            pass
        else:
            raise AssertionError(f"Invalid policy accepted: {terms!r}")
print("Policy validation and stable normalized revision passed.")
