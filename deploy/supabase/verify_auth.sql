-- Transactional rehearsal: creates synthetic auth rows and rolls them back.
BEGIN;
DO $$
DECLARE
  member UUID := gen_random_uuid();
  session UUID := gen_random_uuid();
  client UUID := gen_random_uuid();
  community UUID := gen_random_uuid();
  claims JSONB;
BEGIN
  INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,is_anonymous,created_at,updated_at)
  VALUES(member,'authenticated','authenticated','auth-rehearsal@example.invalid',now(),false,now(),now());
  INSERT INTO auth.sessions(id,user_id,created_at,updated_at,not_after)
  VALUES(session,member,now(),now(),now()+interval '1 hour');
  ASSERT buzz.managed_auth_session_active(member,session), 'verified active session rejected';
  ASSERT NOT buzz.managed_auth_session_active(gen_random_uuid(),session), 'wrong account accepted';
  UPDATE auth.users SET email_confirmed_at=NULL WHERE id=member;
  ASSERT NOT buzz.managed_auth_session_active(member,session), 'unverified account accepted';
  UPDATE auth.users SET email_confirmed_at=now(),banned_until=now()+interval '1 hour' WHERE id=member;
  ASSERT NOT buzz.managed_auth_session_active(member,session), 'suspended account accepted';
  UPDATE auth.users SET banned_until=NULL WHERE id=member;
  UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id=session;
  ASSERT NOT buzz.managed_auth_session_active(member,session), 'expired session accepted';
  DELETE FROM auth.sessions WHERE id=session;
  ASSERT NOT buzz.managed_auth_session_active(member,session), 'revoked session accepted';
  ASSERT NOT has_schema_privilege('anon','buzz','USAGE'), 'anon schema access';
  ASSERT NOT has_schema_privilege('authenticated','buzz','USAGE'), 'browser schema access';
  ASSERT NOT has_table_privilege('authenticated','buzz.managed_accounts','SELECT'), 'key access';
  ASSERT NOT has_table_privilege('authenticated','buzz.hosted_agents','SELECT'), 'private agent access';
  ASSERT NOT has_function_privilege('authenticated','buzz.managed_auth_session_active(uuid,uuid)','EXECUTE'), 'private session function access';
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',member,'exp',extract(epoch FROM now())::bigint+3600)::text,true);
  BEGIN
    PERFORM public.creatorhive_membership(gen_random_uuid());
    RAISE EXCEPTION 'member JWT accepted as owned app';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',member,'client_id',gen_random_uuid(),'session_id',session,'exp',extract(epoch FROM now())::bigint+3600)::text,true);
  BEGIN
    PERFORM public.creatorhive_membership(gen_random_uuid());
    RAISE EXCEPTION 'unregistered/revoked app accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- Synthetic OAuth registration/session exists only inside this rolled-back test.
  INSERT INTO buzz.communities(id,host) VALUES(community,'auth-test-'||community::text);
  INSERT INTO auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method)
  VALUES(client,'manual','https://sso-demo.creatorhive.ai/callback','authorization_code refresh_token','public','none');
  INSERT INTO buzz.owned_oauth_apps(community_id,client_id,name) VALUES(community,client,'Rehearsal');
  INSERT INTO auth.oauth_consents(id,user_id,client_id,scopes) VALUES(gen_random_uuid(),member,client,'openid email profile');
  INSERT INTO auth.sessions(id,user_id,oauth_client_id,not_after,scopes) VALUES(session,member,client,now()+interval '1 hour','openid email profile');
  claims := jsonb_build_object('role','authenticated','sub',member,'client_id',client,'session_id',session,'scope','openid email profile','exp',extract(epoch FROM now())::bigint+3600);
  PERFORM set_config('request.jwt.claims',claims::text,true);
  ASSERT public.creatorhive_membership(community)->>'id'=member::text, 'approved app rejected';
  ASSERT public.creatorhive_membership(community)->>'community_access'='false', 'unadmitted account got access';
  INSERT INTO buzz.managed_accounts(community_id,account_id,pubkey,key_version,sealed_secret)
    VALUES(community,member,repeat('a1',32),1,decode(repeat('00',60),'hex'));
  INSERT INTO buzz.relay_members(community_id,pubkey,role) VALUES(community,repeat('a1',32),'member');
  ASSERT public.creatorhive_membership(community)->>'community_access'='true', 'admitted account denied';
  INSERT INTO buzz.community_bans(community_id,pubkey,banned,actor_pubkey)
    VALUES(community,decode(repeat('a1',32),'hex'),true,decode(repeat('b2',32),'hex'));
  ASSERT public.creatorhive_membership(community)->>'community_access'='false', 'banned member retained app access';
  UPDATE buzz.community_bans SET ban_expires_at=now()-interval '1 second' WHERE community_id=community;
  ASSERT public.creatorhive_membership(community)->>'community_access'='true', 'expired ban retained';
  DELETE FROM buzz.relay_members WHERE community_id=community;
  ASSERT public.creatorhive_membership(community)->>'community_access'='false', 'removed member retained app access';
  ASSERT NOT buzz.managed_auth_session_active(member,session), 'OAuth session accepted by signer authority';
  PERFORM set_config('request.jwt.claims',(claims || '{"scope":"openid"}'::jsonb)::text,true);
  BEGIN
    PERFORM public.creatorhive_membership(community);
    RAISE EXCEPTION 'narrow token read unconsented email/profile';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claims',claims::text,true);
  BEGIN
    PERFORM public.creatorhive_membership(gen_random_uuid());
    RAISE EXCEPTION 'cross-community app access accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE auth.oauth_consents SET revoked_at=now() WHERE client_id=client;
  BEGIN
    PERFORM public.creatorhive_membership(community);
    RAISE EXCEPTION 'revoked grant still returned profile';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;
