-- Close the pre-bootstrap direct profile RPC bypass. Apply after moderation_profiles.sql.
CREATE OR REPLACE FUNCTION buzz.moderation_profile_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE account RECORD;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM buzz.managed_accounts WHERE account_id=NEW.account_id) THEN
  RAISE EXCEPTION 'Finish community sign-in before saving your profile.' USING ERRCODE='42501';
 END IF;
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
