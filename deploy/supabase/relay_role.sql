-- Database-only setup. Password remains unset until supplied through psql
-- \password buzz_relay or the operator's protected credential workflow.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buzz_relay') THEN
        CREATE ROLE buzz_relay LOGIN INHERIT NOSUPERUSER NOCREATEDB
            NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 30;
    END IF;
END $$;
GRANT buzz_backend TO buzz_relay;
ALTER ROLE buzz_relay SET search_path = buzz, extensions;
-- 10 primary + up to 10 search + 5 audit connections; remaining headroom
-- permits readiness checks. No DDL or auth-schema access is granted.
