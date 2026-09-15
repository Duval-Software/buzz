-- Apply after SQLx migrations, via Supabase MCP. Not part of auth's own migrations.
-- Only the backend DB role may execute this; no access to auth tables is granted.
CREATE OR REPLACE FUNCTION buzz.managed_auth_session_active(account_id UUID, session_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = '' AS $$
    SELECT EXISTS (
        SELECT 1 FROM auth.sessions s JOIN auth.users u ON u.id = s.user_id
        WHERE s.id = session_id AND s.user_id = account_id
          AND s.oauth_client_id IS NULL
          AND (s.not_after IS NULL OR s.not_after > now())
          AND u.email_confirmed_at IS NOT NULL
          AND NOT u.is_anonymous
          AND u.deleted_at IS NULL
          AND (u.banned_until IS NULL OR u.banned_until <= now())
    )
$$;
REVOKE ALL ON FUNCTION buzz.managed_auth_session_active(UUID,UUID) FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'buzz_backend') THEN
        CREATE ROLE buzz_backend NOLOGIN;
    END IF;
END $$;
GRANT USAGE ON SCHEMA buzz, extensions TO buzz_backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA buzz TO buzz_backend;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA buzz TO buzz_backend;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA buzz TO buzz_backend;
ALTER DEFAULT PRIVILEGES IN SCHEMA buzz GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO buzz_backend;
ALTER DEFAULT PRIVILEGES IN SCHEMA buzz GRANT USAGE, SELECT ON SEQUENCES TO buzz_backend;
ALTER DEFAULT PRIVILEGES IN SCHEMA buzz GRANT EXECUTE ON FUNCTIONS TO buzz_backend;
-- Partition maintenance remains an operator job: the backend does not own DDL.
