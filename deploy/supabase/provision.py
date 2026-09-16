#!/usr/bin/env python3
"""Plan or apply the ordered database setup through psql's existing migration ledger.

Use an operator connection in PGDATABASE (or a configured PGSERVICE). Runtime
credentials never migrate. Provider login/SMTP settings and passwords stay out
of these migrations. Default is read-only planning; --apply is explicit.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

from export_migrations import export

HERE = Path(__file__).resolve().parent


def steps():
    result = export()
    for name, filename, checksum in json.loads((HERE / "setup.json").read_text()):
        contents = (HERE / filename).read_bytes()
        if hashlib.sha256(contents).hexdigest() != checksum:
            raise ValueError(f"Published setup changed: {filename}. Add a new migration instead.")
        result.append({"name": name, "query": contents.decode()})
    return result


def psql(sql):
    return subprocess.check_output(["psql", "-XAt", "-v", "ON_ERROR_STOP=1"], input=sql, text=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--export", action="store_true", help="Print ordered MCP migration arguments for a fresh project; no connection")
    parser.add_argument("--project", help="Supabase project ref for --export")
    args = parser.parse_args()
    migrations = steps()
    if args.export:
        if not args.project:
            parser.error("--export requires --project")
        print(json.dumps([dict(project_id=args.project, name=row["name"], query=row["query"]) for row in migrations]))
        return
    if not os.environ.get("PGDATABASE") and not os.environ.get("PGSERVICE"):
        parser.error("Set a protected operator connection in PGDATABASE or PGSERVICE")
    exists = psql("select to_regclass('supabase_migrations.schema_migrations') is not null;").strip() == "t"
    applied = set(psql("select name from supabase_migrations.schema_migrations;").splitlines()) if exists else set()
    pending = [row for row in migrations if row["name"] not in applied]
    for row in migrations:
        print(f"{'APPLIED' if row['name'] in applied else 'PENDING'} {row['name']}")
    if not args.apply:
        print(f"{len(pending)} pending. Review before running with --apply.")
        return
    # Use the same native ledger as Supabase MCP and CLI, not a second migration system.
    ledger = """CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
version text PRIMARY KEY, statements text[], name text);
"""
    for index, row in enumerate(migrations):
        if row["name"] in applied:
            continue
        name = row["name"].replace("'", "''")
        statement = row["query"].replace("'", "''")
        sql = f"BEGIN;\nSELECT pg_advisory_xact_lock(76190211);\n{ledger}"
        # Recheck under the lock so two operators cannot apply the same setup twice.
        sql += f"SELECT NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name='{name}') AS pending \\gset\n\\if :pending\n"
        sql += row["query"] + f"\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('20260916{index:06d}','{name}',ARRAY['{statement}']);\n\\endif\nCOMMIT;\n"
        psql(sql)
        print(f"APPLIED {row['name']}")
    print("Database setup applied. Run verify_database.sql and verify_keeper_role.sql using the actual restricted runtime connections.")


if __name__ == "__main__":
    main()
