-- Transactional rehearsal; never leave synthetic accounts or agents behind.
BEGIN;
DO $$
DECLARE
  test_community UUID := gen_random_uuid();
  account UUID := gen_random_uuid();
  owner_key TEXT := repeat('a1',32);
  agent_key TEXT := repeat('b2',32);
  staff_key TEXT := repeat('c3',32);
  agent_record JSONB;
BEGIN
  INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,is_anonymous,created_at,updated_at)
    VALUES(account,'authenticated','authenticated','agent-test@example.invalid',now(),false,now(),now());
  INSERT INTO buzz.communities(id,host) VALUES(test_community,'agent-test-'||test_community::text);
  INSERT INTO buzz.managed_accounts(community_id,account_id,pubkey,key_version,sealed_secret)
    VALUES(test_community,account,owner_key,1,decode(repeat('00',60),'hex'));
  INSERT INTO buzz.relay_members(community_id,pubkey,role) VALUES(test_community,owner_key,'member');
  INSERT INTO buzz.users(community_id,pubkey) VALUES(test_community,decode(owner_key,'hex'));
  agent_record := jsonb_build_object('pubkey',agent_key,'owner',owner_key,'paused',false);
  INSERT INTO buzz.hosted_agents(community_id,pubkey,owner_pubkey,record)
    VALUES(test_community,agent_key,owner_key,agent_record);
  ASSERT buzz.managed_hosted_agent_active(test_community,agent_key), 'agent admission failed';
  ASSERT (SELECT agent_owner_pubkey=decode(owner_key,'hex') AND channel_add_policy='owner_only'
    FROM buzz.users WHERE community_id=test_community AND pubkey=decode(agent_key,'hex')), 'shared agent ownership missing';
  ASSERT (SELECT role='member' FROM buzz.relay_members WHERE community_id=test_community AND pubkey=agent_key), 'agent got staff role';
  ASSERT NOT EXISTS (SELECT 1 FROM buzz.channel_members WHERE community_id=test_community), 'agent auto-joined channels';
  ASSERT NOT buzz.managed_hosted_agent_active(gen_random_uuid(),agent_key), 'cross-test_community access';
  ASSERT NOT buzz.managed_hosted_agent_active(test_community,owner_key), 'member accepted as agent';
  UPDATE buzz.hosted_agents SET record=record || '{"paused":true}'::jsonb WHERE community_id=test_community AND pubkey=agent_key;
  ASSERT NOT buzz.managed_hosted_agent_active(test_community,agent_key), 'paused agent active';
  UPDATE buzz.hosted_agents SET record=record || '{"paused":false}'::jsonb WHERE community_id=test_community AND pubkey=agent_key;
  ASSERT buzz.managed_hosted_agent_active(test_community,agent_key), 'resume failed';
  INSERT INTO buzz.community_bans(community_id,pubkey,banned,actor_pubkey)
    VALUES(test_community,decode(owner_key,'hex'),true,decode(staff_key,'hex'));
  ASSERT NOT buzz.managed_hosted_agent_active(test_community,agent_key), 'community-banned owner retained agent';
  UPDATE buzz.community_bans SET ban_expires_at=now()-interval '1 second'
    WHERE community_id=test_community;
  ASSERT buzz.managed_hosted_agent_active(test_community,agent_key), 'expired community ban blocked agent';
  UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id=account;
  ASSERT NOT buzz.managed_hosted_agent_active(test_community,agent_key), 'banned account retained agent';
  UPDATE auth.users SET banned_until=NULL,email_confirmed_at=NULL WHERE id=account;
  ASSERT NOT buzz.managed_hosted_agent_active(test_community,agent_key), 'unverified account retained agent';
  UPDATE auth.users SET email_confirmed_at=now() WHERE id=account;
  BEGIN
    UPDATE buzz.hosted_agents SET owner_pubkey=staff_key,record=record||jsonb_build_object('owner',staff_key)
      WHERE community_id=test_community AND pubkey=agent_key;
    RAISE EXCEPTION 'agent ownership transfer accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO buzz.relay_members(community_id,pubkey,role) VALUES(test_community,staff_key,'admin');
  BEGIN
    INSERT INTO buzz.hosted_agents(community_id,pubkey,owner_pubkey,record)
      VALUES(test_community,staff_key,owner_key,agent_record||jsonb_build_object('pubkey',staff_key));
    RAISE EXCEPTION 'staff key adopted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  ASSERT (SELECT role='admin' FROM buzz.relay_members WHERE community_id=test_community AND pubkey=staff_key), 'staff role changed';
  DELETE FROM buzz.relay_members WHERE community_id=test_community AND pubkey=owner_key;
  ASSERT NOT buzz.managed_hosted_agent_active(test_community,agent_key), 'removed owner retained agent';
  DELETE FROM buzz.hosted_agents WHERE community_id=test_community AND pubkey=agent_key;
  ASSERT NOT EXISTS (SELECT 1 FROM buzz.relay_members WHERE community_id=test_community AND pubkey=agent_key), 'deleted agent retained admission';
  ASSERT NOT has_function_privilege('authenticated','buzz.managed_hosted_agent_active(uuid,text)','EXECUTE'), 'browser can inspect agent authority';
  ASSERT NOT has_table_privilege('buzz_agentkeeper','buzz.managed_accounts','SELECT'), 'keeper can read signing keys';
  ASSERT NOT has_table_privilege('buzz_agentkeeper','auth.users','SELECT'), 'keeper can read accounts';
  ASSERT NOT has_table_privilege('buzz_agentkeeper','buzz.relay_members','INSERT'), 'keeper can directly grant membership';
  ASSERT NOT has_table_privilege('buzz_agentkeeper','buzz.events','SELECT'), 'keeper can directly read all chat';
END $$;
ROLLBACK;
