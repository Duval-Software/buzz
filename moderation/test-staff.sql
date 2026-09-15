\set ON_ERROR_STOP on
BEGIN;
SET search_path=public;
INSERT INTO communities(id,host) VALUES('00000000-0000-0000-0000-000000000032','staff-tests.invalid');
INSERT INTO relay_members(community_id,pubkey,role) VALUES
 ('00000000-0000-0000-0000-000000000032',repeat('a',64),'owner'),
 ('00000000-0000-0000-0000-000000000032',repeat('b',64),'admin'),
 ('00000000-0000-0000-0000-000000000032',repeat('c',64),'moderator'),
 ('00000000-0000-0000-0000-000000000032',repeat('d',64),'member');
INSERT INTO moderation_word_policy VALUES('00000000-0000-0000-0000-000000000032','test',ARRAY['kill yourself','testblocked'],now());
DO $$
DECLARE community UUID:='00000000-0000-0000-0000-000000000032'; owner BYTEA:=decode(repeat('a',64),'hex'); admin BYTEA:=decode(repeat('b',64),'hex'); moderator BYTEA:=decode(repeat('c',64),'hex'); member BYTEA:=decode(repeat('d',64),'hex'); result JSONB; action UUID; denied BOOLEAN; count_before BIGINT;
BEGIN
 PERFORM moderation_check_text(community,'An ordinary damn sentence, testblockedness, class.');
 FOREACH result IN ARRAY ARRAY[to_jsonb('KILL   YOURSELF'::text),to_jsonb('ｔｅｓｔｂｌｏｃｋｅｄ'::text),to_jsonb('test'||chr(8203)||'blocked')] LOOP
  denied:=false; BEGIN PERFORM moderation_check_text(community,result#>>'{}'); EXCEPTION WHEN SQLSTATE '22023' THEN denied:=true; END; ASSERT denied,'normalized abuse should be rejected';
 END LOOP;
 denied:=false; BEGIN PERFORM moderation_staff_command(community,member,decode(repeat('1',64),'hex'),9040,jsonb_build_object('p',encode(admin,'hex'),'reason','invalid authority')); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END; ASSERT denied,'member cannot ban';
 denied:=false; BEGIN PERFORM moderation_staff_command(community,moderator,decode(repeat('2',64),'hex'),9040,jsonb_build_object('p',encode(member,'hex'),'reason','invalid authority')); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END; ASSERT denied,'moderator cannot ban';
 denied:=false; BEGIN PERFORM moderation_staff_command(community,admin,decode(repeat('3',64),'hex'),9040,jsonb_build_object('p',encode(owner,'hex'),'reason','protected owner')); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END; ASSERT denied,'owner protected';
 result:=moderation_staff_command(community,moderator,decode(repeat('4',64),'hex'),9042,jsonb_build_object('p',encode(member,'hex'),'reason','Repeated harassment','expiration',extract(epoch FROM now()+interval '1 hour')::bigint));
 ASSERT EXISTS(SELECT 1 FROM community_bans WHERE community_id=community AND pubkey=member AND muted_until>now()),'timeout applied';
 SELECT count(*) INTO count_before FROM moderation_actions WHERE community_id=community;
 result:=moderation_staff_command(community,moderator,decode(repeat('4',64),'hex'),9042,jsonb_build_object('p',encode(member,'hex'),'reason','Repeated harassment','expiration',extract(epoch FROM now()+interval '1 hour')::bigint));
 ASSERT result->>'duplicate'='true','command replay idempotent'; ASSERT (SELECT count(*) FROM moderation_actions WHERE community_id=community)=count_before,'no duplicate audit';
 denied:=false; BEGIN PERFORM moderation_staff_command(community,moderator,decode(repeat('5',64),'hex'),9042,jsonb_build_object('p',encode(member,'hex'),'reason','Too long timeout','expiration',extract(epoch FROM now()+interval '8 days')::bigint)); EXCEPTION WHEN raise_exception THEN denied:=true; END; ASSERT denied,'timeout bounded';
 result:=moderation_staff_command(community,admin,decode(repeat('6',64),'hex'),9040,jsonb_build_object('p',encode(member,'hex'),'reason','Repeated harassment'));action:=(result->>'action_id')::uuid;
 INSERT INTO moderation_appeals VALUES(community,action,member,'Please review the context.','open',NULL,NULL,NULL,now(),NULL);
 denied:=false; BEGIN PERFORM moderation_staff_command(community,admin,decode(repeat('7',64),'hex'),9046,jsonb_build_object('appeal',action,'reason','Review completed','decision','reversed','exception','I would like to review it myself')); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END; ASSERT denied,'independent review required';
 result:=moderation_staff_command(community,owner,decode(repeat('8',64),'hex'),9046,jsonb_build_object('appeal',action,'reason','Reviewed additional context','decision','reversed'));
 ASSERT (SELECT status='reversed' FROM moderation_appeals WHERE community_id=community AND action_id=action),'appeal reversed';
 ASSERT NOT (SELECT banned FROM community_bans WHERE community_id=community AND pubkey=member),'ban lifted';
 result:=moderation_staff_command(community,admin,decode(repeat('9',64),'hex'),9032,jsonb_build_object('p',encode(member,'hex'),'reason','Community moderator appointment','role','moderator','expected','member'));
 ASSERT (SELECT role='moderator' FROM relay_members WHERE community_id=community AND pubkey=encode(member,'hex')),'admin appoints moderator';
 denied:=false; BEGIN PERFORM moderation_staff_command(community,admin,decode(repeat('0',64),'hex'),9032,jsonb_build_object('p',encode(member,'hex'),'reason','Forbidden promotion','role','admin','expected','moderator')); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END; ASSERT denied,'only owner appoints admin';
 denied:=false; BEGIN PERFORM moderation_staff_command(community,owner,decode(repeat('f',64),'hex'),9032,jsonb_build_object('p',encode(member,'hex'),'reason','Stale promotion','role','admin','expected','member')); EXCEPTION WHEN serialization_failure THEN denied:=true; END; ASSERT denied,'stale role rejected';
END $$;
ROLLBACK;
BEGIN;
INSERT INTO communities(id,host) VALUES('00000000-0000-0000-0000-000000000033','staff-content.invalid');
INSERT INTO channels(id,community_id,name,created_by,visibility,channel_type) VALUES
 ('00000000-0000-0000-0000-000000000034','00000000-0000-0000-0000-000000000033','Public',decode(repeat('a',64),'hex'),'open','stream'),
 ('00000000-0000-0000-0000-000000000035','00000000-0000-0000-0000-000000000033','Private',decode(repeat('a',64),'hex'),'private','dm');
INSERT INTO relay_members(community_id,pubkey,role) VALUES('00000000-0000-0000-0000-000000000033',repeat('a',64),'admin');
INSERT INTO moderation_word_policy VALUES('00000000-0000-0000-0000-000000000033','test',ARRAY['testblocked'],now());
DO $$
DECLARE community UUID:='00000000-0000-0000-0000-000000000033'; member BYTEA:=decode(repeat('d',64),'hex'); denied BOOLEAN; result JSONB; message_kind INT; private_id BYTEA:=decode(repeat('f',64),'hex');
BEGIN
 denied:=false; BEGIN INSERT INTO events(community_id,id,pubkey,created_at,kind,tags,content,sig,channel_id) VALUES(community,decode(repeat('e',64),'hex'),member,now(),9,'[]','testblocked',decode(repeat('0',128),'hex'),'00000000-0000-0000-0000-000000000034'); EXCEPTION WHEN SQLSTATE '22023' THEN denied:=true; END; ASSERT denied,'public messages rejected';
 INSERT INTO events(community_id,id,pubkey,created_at,kind,tags,content,sig,channel_id) VALUES(community,private_id,member,now(),9,'[]','testblocked',decode(repeat('0',128),'hex'),'00000000-0000-0000-0000-000000000035');
 ASSERT EXISTS(SELECT 1 FROM events WHERE community_id=community AND id=private_id),'private message is not filtered';
 FOREACH message_kind IN ARRAY ARRAY[40002,40006,40008,45001,45003] LOOP
  denied:=false; BEGIN INSERT INTO events(community_id,id,pubkey,created_at,kind,tags,content,sig,channel_id) VALUES(community,decode(md5(message_kind::text)||md5(message_kind::text),'hex'),member,now(),message_kind,'[]','testblocked',decode(repeat('0',128),'hex'),'00000000-0000-0000-0000-000000000034'); EXCEPTION WHEN SQLSTATE '22023' THEN denied:=true; END; ASSERT denied,format('public message kind %s filtered',message_kind);
  INSERT INTO events(community_id,id,pubkey,created_at,kind,tags,content,sig,channel_id) VALUES(community,decode(md5(message_kind::text)||md5(message_kind::text),'hex'),member,now(),message_kind,'[]','testblocked',decode(repeat('0',128),'hex'),'00000000-0000-0000-0000-000000000035');
 END LOOP;
 denied:=false; BEGIN INSERT INTO events(community_id,id,pubkey,created_at,kind,tags,content,sig) VALUES(community,decode(repeat('1',64),'hex'),member,now(),0,'[]','{"display_name":"testblocked"}',decode(repeat('0',128),'hex')); EXCEPTION WHEN SQLSTATE '22023' THEN denied:=true; END; ASSERT denied,'public profile rejected';
 INSERT INTO events(community_id,id,pubkey,created_at,kind,tags,content,sig) VALUES(community,decode(repeat('2',64),'hex'),member,now(),1,'[]','A public update',decode(repeat('0',128),'hex'));
 denied:=false; BEGIN INSERT INTO events(community_id,id,pubkey,created_at,kind,tags,content,sig) VALUES(community,decode(repeat('3',64),'hex'),member,now(),40003,jsonb_build_array(jsonb_build_array('e',repeat('2',64))),'testblocked',decode(repeat('0',128),'hex')); EXCEPTION WHEN SQLSTATE '22023' THEN denied:=true; END; ASSERT denied,'Pulse edit rejected';
 INSERT INTO events(community_id,id,pubkey,created_at,kind,tags,content,sig) VALUES(community,decode(repeat('4',64),'hex'),member,now(),40003,jsonb_build_array(jsonb_build_array('e',repeat('f',64))),'testblocked',decode(repeat('0',128),'hex'));
 INSERT INTO moderation_reports(community_id,report_event_id,reporter_pubkey,target_kind,target_event_id,channel_id,report_type) VALUES(community,decode(repeat('8',64),'hex'),member,'event',private_id,'00000000-0000-0000-0000-000000000035','other');
 result:=moderation_staff_command(community,decode(repeat('a',64),'hex'),decode(repeat('9',64),'hex'),9044,jsonb_build_object('report',repeat('8',64),'action','delete','reason','Harassment reported by participant','expected','open'));
 ASSERT EXISTS(SELECT 1 FROM events WHERE community_id=community AND id=private_id AND deleted_at IS NOT NULL),'reported private message removed';
 ASSERT EXISTS(SELECT 1 FROM moderation_reports WHERE community_id=community AND status='resolved' AND action_id=(result->>'action_id')::uuid),'resolution linked to real action';
 denied:=false; BEGIN PERFORM moderation_staff_command(community,decode(repeat('a',64),'hex'),decode(repeat('0',64),'hex'),9044,jsonb_build_object('report',repeat('8',64),'action','dismiss','reason','Stale second review','expected','open')); EXCEPTION WHEN serialization_failure THEN denied:=true; END; ASSERT denied,'stale report decisions rejected';
 ASSERT (SELECT count(*) FROM moderation_actions WHERE community_id=community)=1,'no orphan audit';
END $$;
ROLLBACK;

-- Full hierarchy matrix for sanctions, including stale roles and foreign tenants.
BEGIN;
INSERT INTO communities(id,host) VALUES('00000000-0000-0000-0000-000000000036','staff-matrix.invalid');
INSERT INTO relay_members(community_id,pubkey,role) SELECT '00000000-0000-0000-0000-000000000036',repeat(k,64),r FROM (VALUES ('a','owner'),('b','admin'),('c','admin'),('d','moderator'),('e','moderator'),('f','member')) AS roles(k,r);
DO $$
DECLARE community UUID:='00000000-0000-0000-0000-000000000036'; actor RECORD; victim RECORD; allowed BOOLEAN; denied BOOLEAN; command BYTEA; result JSONB;
BEGIN
 FOR actor IN SELECT * FROM relay_members WHERE community_id=community LOOP
  FOR victim IN SELECT * FROM relay_members WHERE community_id=community LOOP
   allowed:=actor.pubkey<>victim.pubkey AND (actor.role='owner' OR (actor.role='admin' AND victim.role IN ('moderator','member')) OR (actor.role='moderator' AND victim.role='member'));
   command:=decode(md5(actor.pubkey||victim.pubkey)||md5(victim.pubkey||actor.pubkey),'hex');
   DELETE FROM community_bans WHERE community_id=community;
   denied:=false;
   BEGIN
    result:=moderation_staff_command(community,decode(actor.pubkey,'hex'),command,9042,jsonb_build_object('p',victim.pubkey,'reason','Permission matrix timeout','expiration',extract(epoch FROM now()+interval '10 minutes')::bigint));
   EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
   ASSERT denied=NOT allowed,format('Timeout hierarchy mismatch: %s to %s',actor.role,victim.role);
  END LOOP;
 END LOOP;
 -- An admin's existing timeout cannot be shortened by a moderator.
 DELETE FROM community_bans WHERE community_id=community;
 PERFORM moderation_staff_command(community,decode(repeat('b',64),'hex'),decode(repeat('1',64),'hex'),9042,jsonb_build_object('p',repeat('f',64),'reason','Administrator timeout','expiration',extract(epoch FROM now()+interval '7 days')::bigint));
 denied:=false; BEGIN PERFORM moderation_staff_command(community,decode(repeat('d',64),'hex'),decode(repeat('2',64),'hex'),9042,jsonb_build_object('p',repeat('f',64),'reason','Attempt to shorten timeout','expiration',extract(epoch FROM now()+interval '10 minutes')::bigint)); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END; ASSERT denied,'moderator cannot shorten admin timeout';
 UPDATE relay_members SET role='member' WHERE community_id=community AND pubkey=repeat('b',64);
 denied:=false; BEGIN PERFORM moderation_staff_command(community,decode(repeat('b',64),'hex'),decode(repeat('3',64),'hex'),9040,jsonb_build_object('p',repeat('f',64),'reason','Revoked admin attempt')); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END; ASSERT denied,'revoked role rejected immediately';
 denied:=false; BEGIN PERFORM moderation_staff_command('00000000-0000-0000-0000-000000000099',decode(repeat('a',64),'hex'),decode(repeat('4',64),'hex'),9040,jsonb_build_object('p',repeat('f',64),'reason','Wrong community attempt')); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END; ASSERT denied,'foreign community rejected';
END $$;
ROLLBACK;
