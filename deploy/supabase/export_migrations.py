#!/usr/bin/env python3
"""Export immutable SQLx migrations for Supabase MCP, including its checksum ledger.

Prints JSON tool arguments. Apply in order with supabase_apply_migration; never
apply schema/schema.sql as well. Existing migrations are deliberately unedited.
"""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROJECT = 'olgskffmtievlhibuhpk'


def export():
    setup = """CREATE SCHEMA IF NOT EXISTS buzz;
REVOKE ALL ON SCHEMA buzz FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA buzz REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA buzz REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA buzz REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
SET LOCAL search_path = buzz, extensions;
CREATE TABLE IF NOT EXISTS buzz._sqlx_migrations (
 version BIGINT PRIMARY KEY, description TEXT NOT NULL,
 installed_on TIMESTAMPTZ NOT NULL DEFAULT now(), success BOOLEAN NOT NULL,
 checksum BYTEA NOT NULL, execution_time BIGINT NOT NULL
);
"""
    result = [dict(project_id=PROJECT, name='buzz_private_schema', query=setup)]
    for path in sorted((ROOT / 'migrations').glob('*.sql')):
        version, description = path.stem.split('_', 1)
        content = path.read_bytes()
        checksum = hashlib.sha384(content).hexdigest()
        description = description.replace('_', ' ').replace("'", "''")
        sql = f"SET LOCAL search_path = buzz, extensions;\n{content.decode()}\n"
        sql += f"INSERT INTO buzz._sqlx_migrations (version,description,success,checksum,execution_time) VALUES ({int(version)},'{description}',true,decode('{checksum}','hex'),0);\n"
        sql += "REVOKE ALL ON ALL TABLES IN SCHEMA buzz FROM PUBLIC, anon, authenticated;\nREVOKE ALL ON ALL SEQUENCES IN SCHEMA buzz FROM PUBLIC, anon, authenticated;\nREVOKE ALL ON ALL FUNCTIONS IN SCHEMA buzz FROM PUBLIC, anon, authenticated;\n"
        result.append(dict(project_id=PROJECT, name='buzz_' + path.stem, query=sql))
    return result


if __name__ == '__main__':
    print(json.dumps(export()))
