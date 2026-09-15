#!/usr/bin/env python3
"""Validate the reviewed word file and emit one atomic, tenant-scoped policy update.

Usage: python3 moderation/build_policy.py --community UUID > /tmp/policy.sql
Apply that output using the deployment database role after migration 0032.
Invalid input exits before producing SQL; the previous policy remains intact.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import unicodedata
from uuid import UUID


def compile_policy(path, community):
    data = json.loads(Path(path).read_text())
    if set(data) != {"version", "terms"} or data["version"] != 1:
        raise ValueError("Unsupported word policy format")
    if not isinstance(data["terms"], list) or not 1 <= len(data["terms"]) <= 1000:
        raise ValueError("Supply between 1 and 1000 literal rules")
    terms = []
    for value in data["terms"]:
        if not isinstance(value, str):
            raise ValueError("Every rule must be text")
        term = " ".join(unicodedata.normalize("NFKC", value).lower().split())
        if not 2 <= len(term) <= 100 or not re.fullmatch(r"[^\W_]+(?: [^\W_]+)*", term):
            raise ValueError("Rules must be literal words or space-separated phrases")
        if term in terms:
            raise ValueError("Duplicate normalized rule")
        terms.append(term)
    canonical = json.dumps(sorted(terms), ensure_ascii=False).encode()
    revision = hashlib.sha256(canonical).hexdigest()
    quoted = ",".join("'" + term.replace("'", "''") + "'" for term in sorted(terms))
    return (f"INSERT INTO buzz.moderation_word_policy(community_id,revision,terms) VALUES "
            f"('{UUID(community)}','{revision}',ARRAY[{quoted}]) ON CONFLICT(community_id) "
            "DO UPDATE SET revision=EXCLUDED.revision,terms=EXCLUDED.terms,updated_at=now();\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--community", required=True)
    parser.add_argument("--file", default=str(Path(__file__).with_name("blocked-words.json")))
    args = parser.parse_args()
    print(compile_policy(args.file, args.community), end="")
