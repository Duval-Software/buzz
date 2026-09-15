-- Community access includes current moderation, not just a retained membership row.
CREATE OR REPLACE FUNCTION public.creatorhive_membership(community_id UUID)
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
       OR NOT coalesce(string_to_array(claims->>'scope',' ') @> ARRAY['openid','email','profile'],false)
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
          AND string_to_array(g.scopes,' ') @> ARRAY['openid','email','profile']
          AND string_to_array(s.scopes,' ') @> ARRAY['openid','email','profile']
    ) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501'; END IF;
    SELECT jsonb_build_object('id',u.id,'email',u.email,
        'display_name',coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name','CreatorHive member'),
        'community_access',EXISTS (
            SELECT 1 FROM buzz.managed_accounts a JOIN buzz.relay_members m USING (community_id,pubkey)
            WHERE a.community_id=creatorhive_membership.community_id AND a.account_id=u.id
              AND NOT EXISTS (SELECT 1 FROM buzz.community_bans b
                WHERE b.community_id=a.community_id AND b.pubkey=decode(a.pubkey,'hex')
                  AND b.banned AND (b.ban_expires_at IS NULL OR b.ban_expires_at>now()))
        )) INTO result FROM auth.users u WHERE u.id=member_id AND u.email_confirmed_at IS NOT NULL
            AND NOT u.is_anonymous AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now());
    IF result IS NULL THEN RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501'; END IF;
    RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.creatorhive_membership(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.creatorhive_membership(UUID) TO authenticated;
