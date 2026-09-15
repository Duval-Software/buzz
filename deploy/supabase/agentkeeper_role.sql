-- The keeper cannot read member signing keys, auth tables, chat or staff controls.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='buzz_agentkeeper') THEN
    CREATE ROLE buzz_agentkeeper LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4;
  END IF;
END $$;
GRANT USAGE ON SCHEMA buzz TO buzz_agentkeeper;
GRANT SELECT ON buzz.communities TO buzz_agentkeeper;
GRANT SELECT,INSERT,UPDATE,DELETE ON buzz.hosted_agents TO buzz_agentkeeper;
ALTER ROLE buzz_agentkeeper SET search_path=buzz;
-- Registry triggers perform bounded admission. Never grant buzz_backend here.
