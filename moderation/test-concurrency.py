#!/usr/bin/env python3
"""Run against a disposable migrated PostgreSQL database (TEST_DATABASE_URL)."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
import subprocess
import uuid

url = os.environ["TEST_DATABASE_URL"]
community = str(uuid.uuid4())
actor = "a" * 64
target = "b" * 64
command = "c" * 64


def query(sql):
    result = subprocess.run(["psql", url, "-XAt", "-v", "ON_ERROR_STOP=1", "-c", sql], capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


try:
    query(f"INSERT INTO communities(id,host) VALUES('{community}','{community}.test.invalid');"
          f"INSERT INTO relay_members(community_id,pubkey,role) VALUES('{community}','{actor}','admin'),('{community}','{target}','member');")
    sql = f"SELECT moderation_staff_command('{community}',decode('{actor}','hex'),decode('{command}','hex'),9040,'{{\"p\":\"{target}\",\"reason\":\"Concurrent review test\"}}');"
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(query, [sql] * 8))
    assert sum(not json.loads(result).get("duplicate", False) for result in results) == 1
    assert query(f"SELECT count(*) FROM moderation_actions WHERE community_id='{community}'") == "1"
    print("Eight concurrent submissions produced one restriction and one audit entry.")
finally:
    for table in ["community_bans", "moderation_actions", "relay_members", "communities"]:
        column = "id" if table == "communities" else "community_id"
        query(f"DELETE FROM {table} WHERE {column}='{community}'")
