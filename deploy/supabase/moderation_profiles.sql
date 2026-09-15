-- Apply after SQLx 0032 and member_profiles.sql. No browser grants to staff tables.
CREATE OR REPLACE VIEW buzz.moderation_member_directory AS
 SELECT m.community_id,m.pubkey,m.role,p.username,
 coalesce(p.display_name,'Member') AS display_name
 FROM buzz.relay_members m
 LEFT JOIN buzz.managed_accounts a ON a.community_id=m.community_id AND a.pubkey=m.pubkey
 LEFT JOIN buzz.member_profiles p ON p.account_id=a.account_id;

CREATE FUNCTION buzz.moderation_profile_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE account RECORD;
BEGIN
 FOR account IN SELECT community_id,pubkey FROM buzz.managed_accounts WHERE account_id=NEW.account_id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('moderation:'||account.community_id::text,0));
  PERFORM buzz.moderation_check_text(account.community_id,NEW.username);
  PERFORM buzz.moderation_check_text(account.community_id,NEW.display_name);
  IF EXISTS(SELECT 1 FROM buzz.moderation_rename_holds WHERE community_id=account.community_id AND username=NEW.username) THEN
   RAISE EXCEPTION 'This username is unavailable. Choose another.' USING ERRCODE='22023'; END IF;
  UPDATE buzz.moderation_rename_holds SET required=false WHERE community_id=account.community_id AND pubkey=decode(account.pubkey,'hex') AND required;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER moderation_profile_guard BEFORE INSERT OR UPDATE ON buzz.member_profiles FOR EACH ROW EXECUTE FUNCTION buzz.moderation_profile_guard();
-- Keep the current active-session profile RPC, also enforce policy/holds on availability checks.
ALTER FUNCTION public.creatorhive_profile(text,text,jsonb) RENAME TO creatorhive_profile_unfiltered;
REVOKE ALL ON FUNCTION public.creatorhive_profile_unfiltered(text,text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.creatorhive_profile(operation TEXT,proposed_username TEXT DEFAULT NULL,profile_data JSONB DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result JSONB; account RECORD; handle TEXT:=lower(btrim(proposed_username));
BEGIN
 -- Existing RPC authenticates before either reads or writes; its write trigger enforces policy.
 result:=public.creatorhive_profile_unfiltered(operation,proposed_username,profile_data);
 IF operation='check' THEN
  FOR account IN SELECT community_id FROM buzz.managed_accounts WHERE account_id=auth.uid() LOOP
   PERFORM buzz.moderation_check_text(account.community_id,handle);
   IF EXISTS(SELECT 1 FROM buzz.moderation_rename_holds WHERE community_id=account.community_id AND username=handle) THEN RETURN jsonb_build_object('available',false); END IF;
  END LOOP;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.creatorhive_profile(text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.creatorhive_profile(text,text,jsonb) TO authenticated;
REVOKE ALL ON buzz.moderation_rename_holds,buzz.moderation_appeals,buzz.moderation_word_policy,buzz.moderation_member_directory FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON buzz.moderation_rename_holds,buzz.moderation_appeals,buzz.moderation_word_policy TO buzz_relay;
GRANT SELECT ON buzz.moderation_member_directory TO buzz_relay;
GRANT EXECUTE ON FUNCTION buzz.moderation_staff_command(UUID,BYTEA,BYTEA,INT,JSONB),buzz.moderation_check_text(UUID,TEXT) TO buzz_relay;

CREATE POLICY backend_rename ON buzz.moderation_rename_holds FOR ALL TO buzz_backend USING(true) WITH CHECK(true);
CREATE POLICY backend_appeals ON buzz.moderation_appeals FOR ALL TO buzz_backend USING(true) WITH CHECK(true);
CREATE POLICY backend_word_policy ON buzz.moderation_word_policy FOR ALL TO buzz_backend USING(true) WITH CHECK(true);
GRANT EXECUTE ON FUNCTION buzz.moderation_delete_event(UUID,BYTEA) TO buzz_relay;
