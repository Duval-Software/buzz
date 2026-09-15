-- psql -v community_id=<preview UUID> -v owner_pubkey=<verified preview member>
-- Connect as buzz_agentkeeper. The synthetic record is always rolled back.
\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('creatorhive.test_community', :'community_id', true);
SELECT set_config('creatorhive.test_owner', :'owner_pubkey', true);
DO $$
DECLARE
  community UUID := current_setting('creatorhive.test_community')::uuid;
  owner_key TEXT := current_setting('creatorhive.test_owner');
  agent_key TEXT := md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
BEGIN
  ASSERT current_user='buzz_agentkeeper', 'wrong test role';
  ASSERT NOT has_table_privilege(current_user,'buzz.managed_accounts','SELECT'), 'signing-key access';
  ASSERT NOT has_table_privilege(current_user,'buzz.events','SELECT'), 'chat access';
  INSERT INTO buzz.hosted_agents(community_id,pubkey,owner_pubkey,record)
    VALUES(community,agent_key,owner_key,jsonb_build_object('pubkey',agent_key,'owner',owner_key,'paused',false));
  UPDATE buzz.hosted_agents SET record=record||'{"paused":true}'::jsonb
    WHERE community_id=community AND pubkey=agent_key;
  DELETE FROM buzz.hosted_agents WHERE community_id=community AND pubkey=agent_key;
  BEGIN
    INSERT INTO buzz.relay_members(community_id,pubkey,role) VALUES(community,agent_key,'admin');
    RAISE EXCEPTION 'keeper granted staff access';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;
