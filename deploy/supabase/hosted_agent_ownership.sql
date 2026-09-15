-- Materialize registry authority in Buzz's shared ownership/channel-policy row.
-- The admission trigger already verifies the owner and rejects key collisions.
CREATE OR REPLACE FUNCTION buzz.sync_hosted_agent_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO buzz.users(community_id,pubkey,agent_owner_pubkey,channel_add_policy)
    VALUES(NEW.community_id,decode(NEW.pubkey,'hex'),decode(NEW.owner_pubkey,'hex'),'owner_only');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION buzz.sync_hosted_agent_owner() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER hosted_agent_owner AFTER INSERT ON buzz.hosted_agents
FOR EACH ROW EXECUTE FUNCTION buzz.sync_hosted_agent_owner();

-- Repair agents created before this integration, without replacing ownership.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM buzz.hosted_agents a JOIN buzz.users u
    ON u.community_id=a.community_id AND u.pubkey=decode(a.pubkey,'hex')
    WHERE u.agent_owner_pubkey IS NOT NULL AND u.agent_owner_pubkey<>decode(a.owner_pubkey,'hex')) THEN
    RAISE EXCEPTION 'Existing hosted agent ownership conflicts with registry';
  END IF;
END $$;
INSERT INTO buzz.users(community_id,pubkey,agent_owner_pubkey,channel_add_policy)
  SELECT community_id,decode(pubkey,'hex'),decode(owner_pubkey,'hex'),'owner_only'::buzz.channel_add_policy
  FROM buzz.hosted_agents
ON CONFLICT(community_id,pubkey) DO UPDATE
  SET agent_owner_pubkey=EXCLUDED.agent_owner_pubkey,channel_add_policy='owner_only';
