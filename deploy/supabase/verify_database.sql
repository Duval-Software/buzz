-- Run with psql using Buzz's actual DATABASE_URL before starting the relay.
-- Read-only; creates no accounts, channels, or messages.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $$ BEGIN
    IF current_user <> 'buzz_relay' OR current_schema() <> 'buzz' THEN
        RAISE EXCEPTION 'Connect as buzz_relay with search_path=buzz,extensions';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) THEN
        RAISE EXCEPTION 'Database connection must use TLS';
    END IF;
    IF (SELECT count(*) FROM _sqlx_migrations WHERE success) <> 31
       OR (SELECT max(version) FROM _sqlx_migrations) <> 31 THEN
        RAISE EXCEPTION 'Expected all 31 CreatorHive SQLx migrations';
    END IF;
    IF has_schema_privilege(current_user,'buzz','CREATE')
       OR has_schema_privilege(current_user,'auth','USAGE') THEN
        RAISE EXCEPTION 'Runtime role has excessive schema privileges';
    END IF;
END $$;
SELECT current_user AS runtime_role, current_schema() AS application_schema,
       (SELECT count(*) FROM channels) AS channels,
       (SELECT count(*) FROM events) AS messages,
       (SELECT count(*) FROM relay_members) AS members;
ROLLBACK;
