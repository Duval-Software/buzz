-- Synthetic accounts, profiles and sessions are rolled back.
BEGIN;
DO $$
DECLARE
  first_user uuid := gen_random_uuid(); second_user uuid := gen_random_uuid();
  first_session uuid := gen_random_uuid(); second_session uuid := gen_random_uuid();
  handle text := 'test_' || substr(replace(gen_random_uuid()::text,'-',''),1,16);
  details jsonb := '{"display_name":"Test creator","interests":["vibe_coding","ai_ml"],"working_on":"A private project"}';
BEGIN
  INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,is_anonymous,created_at,updated_at)
  VALUES(first_user,'authenticated','authenticated',first_user||'@example.invalid',now(),false,now(),now()),
        (second_user,'authenticated','authenticated',second_user||'@example.invalid',now(),false,now(),now());
  INSERT INTO auth.sessions(id,user_id,created_at,updated_at,not_after)
  VALUES(first_session,first_user,now(),now(),now()+interval '1 hour'),(second_session,second_user,now(),now(),now()+interval '1 hour');
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',first_user,'session_id',first_session,'exp',extract(epoch FROM now())::bigint+3600)::text,true);
  ASSERT public.creatorhive_profile('get') IS NULL;
  ASSERT public.creatorhive_profile('check',handle)->>'available'='true';
  ASSERT public.creatorhive_profile('save',upper(handle),details)->>'username'=handle, 'canonical name';
  ASSERT public.creatorhive_profile('get')->>'working_on'='A private project';
  ASSERT public.creatorhive_profile('check',handle)->>'available'='true', 'own username should remain available';
  ASSERT NOT public.creatorhive_profile('get') ? 'account_id', 'internal ID exposure';
  BEGIN PERFORM public.creatorhive_profile('save','admin',details); RAISE EXCEPTION 'reserved name accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.creatorhive_profile('save',handle,details||'{"interests":["staff"]}'); RAISE EXCEPTION 'invalid interests accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',second_user,'session_id',second_session,'exp',extract(epoch FROM now())::bigint+3600)::text,true);
  ASSERT public.creatorhive_profile('get') IS NULL, 'cross-account read';
  ASSERT public.creatorhive_profile('check',handle)->>'available'='false';
  BEGIN PERFORM public.creatorhive_profile('save',handle,details); RAISE EXCEPTION 'duplicate accepted'; EXCEPTION WHEN unique_violation THEN NULL; END;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',first_user,'session_id',second_session,'exp',extract(epoch FROM now())::bigint+3600)::text,true);
  BEGIN PERFORM public.creatorhive_profile('get'); RAISE EXCEPTION 'forged owner accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',first_user,'session_id',first_session,'client_id',gen_random_uuid(),'exp',extract(epoch FROM now())::bigint+3600)::text,true);
  BEGIN PERFORM public.creatorhive_profile('get'); RAISE EXCEPTION 'OAuth token accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',first_user,'session_id',first_session,'exp',extract(epoch FROM now())::bigint+3600)::text,true);
  DELETE FROM auth.sessions WHERE id=first_session;
  BEGIN PERFORM public.creatorhive_profile('save',handle,details); RAISE EXCEPTION 'revoked session accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT NOT has_table_privilege('authenticated','buzz.member_profiles','SELECT'), 'direct private data access';
  ASSERT NOT has_function_privilege('anon','public.creatorhive_profile(text,text,jsonb)','EXECUTE'), 'anonymous function access';
END $$;
ROLLBACK;
