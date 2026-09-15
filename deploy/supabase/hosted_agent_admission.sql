-- Supabase-only managed agent authority. The keeper can write its registry,
-- never arbitrary relay membership or staff roles. No public channel admission.
CREATE OR REPLACE FUNCTION buzz.managed_agent_owner_active(community UUID, owner_key TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM buzz.managed_accounts a
    JOIN buzz.relay_members m USING (community_id,pubkey)
    JOIN auth.users u ON u.id=a.account_id
    WHERE a.community_id=community AND a.pubkey=owner_key
      AND u.email_confirmed_at IS NOT NULL AND NOT u.is_anonymous
      AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now())
      AND NOT EXISTS (SELECT 1 FROM buzz.community_bans b
        WHERE b.community_id=community AND b.pubkey=decode(owner_key,'hex')
          AND b.banned AND (b.ban_expires_at IS NULL OR b.ban_expires_at>now()))
  )
$$;

CREATE OR REPLACE FUNCTION buzz.managed_hosted_agent_active(community UUID, agent_key TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM buzz.hosted_agents a
    JOIN buzz.relay_members m USING (community_id,pubkey)
    WHERE a.community_id=community AND a.pubkey=agent_key AND m.role='member'
      AND a.record->>'paused'='false'
      AND buzz.managed_agent_owner_active(community,a.owner_pubkey)
      AND NOT EXISTS (SELECT 1 FROM buzz.community_bans b
        WHERE b.community_id=community AND b.pubkey=decode(agent_key,'hex')
          AND b.banned AND (b.ban_expires_at IS NULL OR b.ban_expires_at>now()))
  )
$$;

CREATE OR REPLACE FUNCTION buzz.sync_hosted_agent_membership()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    DELETE FROM buzz.relay_members WHERE community_id=OLD.community_id
      AND pubkey=OLD.pubkey AND role='member' AND added_by=OLD.owner_pubkey;
    RETURN OLD;
  END IF;
  IF NEW.record->>'pubkey' IS DISTINCT FROM NEW.pubkey
    OR NEW.record->>'owner' IS DISTINCT FROM NEW.owner_pubkey
    OR jsonb_typeof(NEW.record->'paused') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'Invalid hosted agent record' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.community_id<>OLD.community_id OR NEW.pubkey<>OLD.pubkey OR NEW.owner_pubkey<>OLD.owner_pubkey THEN
      RAISE EXCEPTION 'Hosted agent identity and owner cannot change' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT buzz.managed_agent_owner_active(NEW.community_id,NEW.owner_pubkey)
    OR EXISTS (SELECT 1 FROM buzz.managed_accounts WHERE community_id=NEW.community_id AND pubkey=NEW.pubkey) THEN
    RAISE EXCEPTION 'Verified community member required for this agent' USING ERRCODE='42501';
  END IF;
  -- A collision must fail, never adopt or demote an existing member/staff key.
  INSERT INTO buzz.relay_members(community_id,pubkey,role,added_by)
    VALUES(NEW.community_id,NEW.pubkey,'member',NEW.owner_pubkey);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS hosted_agent_membership ON buzz.hosted_agents;
CREATE TRIGGER hosted_agent_membership AFTER INSERT OR UPDATE OR DELETE ON buzz.hosted_agents
FOR EACH ROW EXECUTE FUNCTION buzz.sync_hosted_agent_membership();
REVOKE ALL ON FUNCTION buzz.managed_agent_owner_active(UUID,TEXT),
  buzz.managed_hosted_agent_active(UUID,TEXT),buzz.sync_hosted_agent_membership()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION buzz.managed_hosted_agent_active(UUID,TEXT) TO buzz_backend;
