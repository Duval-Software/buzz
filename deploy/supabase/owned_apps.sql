-- Owned clients are registered with Supabase Auth by an operator, then explicitly
-- allowed here. Public/dynamic OAuth registration must remain disabled.
CREATE TABLE buzz.owned_oauth_apps (
    community_id UUID NOT NULL REFERENCES buzz.communities(id) ON DELETE CASCADE,
    client_id UUID NOT NULL,
    name TEXT NOT NULL,
    PRIMARY KEY (community_id, client_id)
);
REVOKE ALL ON buzz.owned_oauth_apps FROM PUBLIC, anon, authenticated;

-- The only browser Data API surface. OAuth tokens cannot sign events or query
-- chat tables. A revoked grant/session fails here even while its JWT is unexpired.
CREATE FUNCTION public.creatorhive_membership(community_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    claims JSONB := auth.jwt();
    member_id UUID := auth.uid();
    client UUID;
    session UUID;
    result JSONB;
BEGIN
    IF claims->>'role' IS DISTINCT FROM 'authenticated'
       OR claims->>'client_id' IS NULL
       OR coalesce((claims->>'exp')::bigint, 0) <= extract(epoch FROM now()) THEN
        RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
    client := (claims->>'client_id')::uuid;
    session := (claims->>'session_id')::uuid;
    IF NOT EXISTS (
        SELECT 1 FROM buzz.owned_oauth_apps a
        JOIN auth.oauth_clients c ON c.id=a.client_id AND c.deleted_at IS NULL
        JOIN auth.oauth_consents g ON g.client_id=c.id AND g.user_id=member_id AND g.revoked_at IS NULL
        JOIN auth.sessions s ON s.id=session AND s.user_id=member_id AND s.oauth_client_id=c.id
        WHERE a.community_id=creatorhive_membership.community_id AND a.client_id=client
          AND (s.not_after IS NULL OR s.not_after>now())
    ) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501'; END IF;
    SELECT jsonb_build_object('id',u.id,'email',u.email,
        'display_name',coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name','CreatorHive member'),
        'community_access',EXISTS (
            SELECT 1 FROM buzz.managed_accounts a JOIN buzz.relay_members m USING (community_id,pubkey)
            WHERE a.community_id=creatorhive_membership.community_id AND a.account_id=u.id
        )) INTO result FROM auth.users u WHERE u.id=member_id AND u.email_confirmed_at IS NOT NULL
            AND NOT u.is_anonymous AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now());
    IF result IS NULL THEN RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501'; END IF;
    RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.creatorhive_membership(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.creatorhive_membership(UUID) TO authenticated;
