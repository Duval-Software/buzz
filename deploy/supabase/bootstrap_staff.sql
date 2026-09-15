-- Operator-only psql script; supply verified Supabase UUIDs, never email matching.
-- Inputs: community_id, lucas_account_id, sean_account_id. Both must first log in.
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE staff_input(community UUID, account UUID, role TEXT) ON COMMIT DROP;
INSERT INTO staff_input VALUES
(:'community_id'::uuid,:'lucas_account_id'::uuid,'owner'),
(:'community_id'::uuid,:'sean_account_id'::uuid,'admin');
DO $$ BEGIN
  IF (SELECT count(DISTINCT account) FROM staff_input)<>2 THEN RAISE EXCEPTION 'Two different verified accounts are required'; END IF;
  IF (SELECT count(*) FROM staff_input i JOIN auth.users u ON u.id=i.account
      JOIN buzz.managed_accounts a ON a.account_id=u.id AND a.community_id=i.community
      JOIN buzz.relay_members m ON m.community_id=a.community_id AND m.pubkey=a.pubkey
      WHERE u.email_confirmed_at IS NOT NULL AND NOT u.is_anonymous AND u.deleted_at IS NULL
        AND (u.banned_until IS NULL OR u.banned_until<=now()))<>2 THEN
    RAISE EXCEPTION 'Staff accounts must be verified, provisioned community members';
  END IF;
  IF EXISTS (SELECT 1 FROM buzz.relay_members m JOIN staff_input i ON i.community=m.community_id AND i.role='owner'
       JOIN buzz.managed_accounts a ON a.community_id=i.community AND a.account_id=i.account
       WHERE m.role='owner' AND m.pubkey<>a.pubkey) THEN
    RAISE EXCEPTION 'An existing different owner requires a separate ownership decision';
  END IF;
END $$;
UPDATE buzz.relay_members m SET role=i.role,updated_at=now()
FROM staff_input i JOIN buzz.managed_accounts a ON a.account_id=i.account AND a.community_id=i.community
WHERE m.community_id=i.community AND m.pubkey=a.pubkey;
UPDATE buzz.channel_members m SET role=i.role::buzz.member_role
FROM staff_input i JOIN buzz.managed_accounts a ON a.account_id=i.account AND a.community_id=i.community,
 buzz.channels c
WHERE m.community_id=i.community AND m.pubkey=decode(a.pubkey,'hex') AND c.community_id=m.community_id AND c.id=m.channel_id
 AND c.name IN ('General','Announcements');
SELECT i.account,i.role,a.pubkey FROM staff_input i JOIN buzz.managed_accounts a ON a.account_id=i.account AND a.community_id=i.community;
COMMIT;
-- Re-login both staff accounts to refresh discovery snapshots. Managed mode does
-- not bootstrap authority from RELAY_OWNER_PUBKEY; these verified DB roles are authoritative.
