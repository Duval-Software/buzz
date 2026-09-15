-- Operator-only psql script. Run BEFORE the first signup in the fresh database.
-- Inputs: community_host and relay_pubkey (public identity of the preview relay).
-- Never supply the relay's private key here. No role or paid entitlement is seeded.
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE seed_input(host TEXT, pubkey TEXT) ON COMMIT DROP;
INSERT INTO seed_input VALUES (:'community_host', :'relay_pubkey');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM seed_input WHERE pubkey ~ '^[0-9a-f]{64}$' AND host ~ '^[a-z0-9.-]+(:[0-9]+)?$') THEN
    RAISE EXCEPTION 'Expected the verified relay host and public key';
  END IF;
END $$;
INSERT INTO buzz.communities(host) SELECT host FROM seed_input ON CONFLICT(lower(host)) DO NOTHING;
INSERT INTO buzz.channels(community_id,name,visibility,created_by,posting_policy)
SELECT c.id,v.name,'open',decode(i.pubkey,'hex'),v.policy
FROM seed_input i JOIN buzz.communities c ON lower(c.host)=i.host
CROSS JOIN (VALUES ('General','all'),('Announcements','admins')) v(name,policy)
WHERE NOT EXISTS (SELECT 1 FROM buzz.channels x WHERE x.community_id=c.id AND lower(x.name)=lower(v.name) AND x.deleted_at IS NULL);
DO $$ BEGIN
  IF (SELECT count(*) FROM buzz.channels ch
      JOIN buzz.communities c ON c.id=ch.community_id
      JOIN seed_input i ON lower(c.host)=i.host
      WHERE c.archived_at IS NULL AND ch.deleted_at IS NULL
        AND ch.visibility='open'
        AND ((lower(ch.name)='general' AND ch.posting_policy='all')
          OR (lower(ch.name)='announcements' AND ch.posting_policy='admins'))) <> 2 THEN
    RAISE EXCEPTION 'Expected one General and one staff-only Announcements channel in an active community';
  END IF;
END $$;
SELECT c.id AS community_id,c.host FROM buzz.communities c JOIN seed_input i ON lower(c.host)=i.host;
COMMIT;
-- The first successful managed bootstrap publishes the relay-signed discovery records.
