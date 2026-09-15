-- Public portfolio data is separate from private onboarding preferences.
-- Publication is additionally gated by BUZZ_PUBLIC_PROFILES=true on the relay.
CREATE TABLE profile_pages (
 community_id UUID NOT NULL, account_id UUID NOT NULL,
 published BOOLEAN NOT NULL DEFAULT false,
 visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','members')),
 presentation JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(community_id,account_id),
 FOREIGN KEY(community_id,account_id) REFERENCES managed_accounts(community_id,account_id) ON DELETE CASCADE,
 CHECK(jsonb_typeof(presentation)='object' AND octet_length(presentation::text)<=24000)
);
CREATE TABLE profile_images (
 community_id UUID NOT NULL, account_id UUID NOT NULL, id UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(community_id,id),
 FOREIGN KEY(community_id,account_id) REFERENCES managed_accounts(community_id,account_id) ON DELETE CASCADE
);
ALTER TABLE profile_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_images ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON profile_pages,profile_images FROM PUBLIC;

-- Resolve only the owner's unscoped root notes. Re-read edits/deletions on every
-- request; do not export replies, reactions, tags, attachments or raw events.
CREATE FUNCTION profile_pulse(community UUID, author TEXT, target TEXT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
 SELECT jsonb_build_object('kind','pulse','event_id',encode(e.id,'hex'),'text',coalesce(edit.content,e.content),'created_at',extract(epoch FROM e.created_at))
 FROM events e
 LEFT JOIN LATERAL (
   SELECT x.content FROM events x WHERE x.community_id=e.community_id AND x.pubkey=e.pubkey
   AND x.kind=40003 AND x.deleted_at IS NULL AND x.channel_id IS NULL
   AND (x.not_before IS NULL OR x.not_before<=extract(epoch FROM now()))
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(x.tags) t WHERE t->>0='h')
   AND x.created_at>=e.created_at AND x.tags @> jsonb_build_array(jsonb_build_array('e',target))
   ORDER BY x.created_at DESC, x.id DESC LIMIT 1
 ) edit ON true
 WHERE e.community_id=community AND e.id=decode(target,'hex') AND e.pubkey=decode(author,'hex')
 AND e.kind=1 AND e.channel_id IS NULL AND e.deleted_at IS NULL AND (e.not_before IS NULL OR e.not_before<=extract(epoch FROM now()))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e.tags) t WHERE t->>0 IN ('h','e'))
 AND NOT EXISTS(SELECT 1 FROM events d WHERE d.community_id=e.community_id AND d.pubkey=e.pubkey AND d.kind=5
   AND d.tags @> jsonb_build_array(jsonb_build_array('e',target)))
 LIMIT 1
$$;
REVOKE ALL ON FUNCTION profile_pulse(UUID,TEXT,TEXT) FROM PUBLIC;
