"""Fresh schema, repeat setup, drift rejection and transaction rollback in disposable Postgres.

Requires Docker. Auth fixtures exercise DDL dependencies, not real Supabase login.
"""
import contextlib
import io
import os
from pathlib import Path
import subprocess
import sys
import time
from unittest.mock import patch
from uuid import uuid4

import provision

name = "creatorhive-setup-test-" + uuid4().hex[:10]


def sql(query):
    return subprocess.check_output(["docker", "exec", "-i", name, "psql", "-U", "postgres", "-XAt", "-v", "ON_ERROR_STOP=1"], input=query, text=True, stderr=subprocess.PIPE)


try:
    subprocess.run(["docker", "run", "-d", "--name", name, "--memory", "256m", "--cpus", "0.5", "--network", "none",
                    "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine"], check=True, stdout=subprocess.DEVNULL)
    for _ in range(30):
        if subprocess.run(["docker", "exec", name, "pg_isready", "-U", "postgres"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
            break
        time.sleep(1)
    sql("""CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth; CREATE SCHEMA extensions;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb,
 email_confirmed_at timestamptz, is_anonymous boolean, deleted_at timestamptz, banned_until timestamptz);
CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,oauth_client_id uuid,not_after timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
""")
    with patch.object(provision, "psql", sql), patch.dict(os.environ, {"PGDATABASE": "fixture"}), patch.object(sys, "argv", ["provision.py", "--apply"]), contextlib.redirect_stdout(io.StringIO()):
        provision.main()
        provision.main()
    assert int(sql("SELECT count(*) FROM supabase_migrations.schema_migrations;")) == len(provision.steps())
    verifier = (Path(__file__).parent / "expected-migrations.sql").read_text()
    sql("SET search_path=buzz,extensions;\n" + verifier)
    try:
        sql("BEGIN; SET search_path=buzz,extensions; UPDATE _sqlx_migrations SET checksum='bad' WHERE version=1;\n" + verifier)
        raise AssertionError("Altered migration was accepted")
    except subprocess.CalledProcessError:
        pass
    bad = provision.steps() + [{"name": "deliberately_failed_setup", "query": "CREATE TABLE buzz.must_rollback(id int); SELECT no_such_function();"}]
    with patch.object(provision, "psql", sql), patch.object(provision, "steps", return_value=bad), patch.dict(os.environ, {"PGDATABASE": "fixture"}), patch.object(sys, "argv", ["provision.py", "--apply"]), contextlib.redirect_stdout(io.StringIO()):
        try:
            provision.main()
            raise AssertionError("Failed migration was accepted")
        except subprocess.CalledProcessError:
            pass
    assert sql("SELECT to_regclass('buzz.must_rollback') IS NULL;").strip() == "t"
    assert sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE name='deliberately_failed_setup';").strip() == "0"
    sql("CREATE TABLE public.communities(id uuid);")
    with patch.object(provision, "psql", sql), patch.dict(os.environ, {"PGDATABASE": "fixture"}), patch.object(sys, "argv", ["provision.py", "--apply"]), contextlib.redirect_stderr(io.StringIO()):
        try:
            provision.main()
            raise AssertionError("Legacy production target accepted")
        except SystemExit as error:
            assert error.code == 2
    print("Fresh setup, idempotent rerun, checksum rejection, transaction rollback and legacy-target refusal passed.")
finally:
    subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
