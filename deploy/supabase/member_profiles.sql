-- Private member preferences; usernames are global within CreatorHive, not login credentials.
CREATE TABLE buzz.member_profiles (
  account_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z][a-z0-9_]{2,23}$'),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 60),
  interests text[] NOT NULL DEFAULT '{}',
  working_on text NOT NULL DEFAULT '' CHECK (length(working_on) <= 240),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(interests) <= 8 AND interests <@ ARRAY['vibe_coding','software','ai_ml','design','content','hardware','business','exploring']::text[])
);
ALTER TABLE buzz.member_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON buzz.member_profiles FROM PUBLIC, anon, authenticated;

-- Only the member's active first-party session may read/update their record.
-- OAuth app tokens cannot use this RPC, and no email or other member's record is returned.
CREATE FUNCTION public.creatorhive_profile(operation text, proposed_username text DEFAULT NULL, profile_data jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  claims jsonb := auth.jwt();
  member uuid := auth.uid();
  handle text := lower(btrim(proposed_username));
  result jsonb;
  selected text[];
BEGIN
  IF claims->>'role' IS DISTINCT FROM 'authenticated'
    OR claims->>'client_id' IS NOT NULL
    OR coalesce((claims->>'exp')::bigint,0) <= extract(epoch FROM now())
    OR NOT coalesce(buzz.managed_auth_session_active(member,(claims->>'session_id')::uuid),false)
  THEN RAISE EXCEPTION 'Please sign in again.' USING ERRCODE='42501'; END IF;
  IF operation = 'get' THEN
    SELECT to_jsonb(p) - 'account_id' INTO result FROM buzz.member_profiles p WHERE p.account_id=member;
    RETURN result;
  END IF;
  IF operation NOT IN ('check','save') OR operation IS NULL THEN
    RAISE EXCEPTION 'Unsupported profile operation.' USING ERRCODE='22023';
  END IF;
  IF handle IS NULL OR handle !~ '^[a-z][a-z0-9_]{2,23}$'
    OR handle = ANY(ARRAY['admin','administrator','creatorhive','support','system','moderator','everyone','here'])
  THEN RAISE EXCEPTION 'Use 3–24 letters, numbers or underscores, starting with a letter. This name may be reserved.' USING ERRCODE='22023'; END IF;
  IF operation = 'check' THEN
    RETURN jsonb_build_object('available', NOT EXISTS(SELECT 1 FROM buzz.member_profiles p WHERE p.username=handle AND p.account_id<>member));
  END IF;
  IF profile_data IS NULL OR jsonb_typeof(profile_data) <> 'object'
    OR coalesce(length(btrim(profile_data->>'display_name')),0) NOT BETWEEN 1 AND 60
    OR length(coalesce(profile_data->>'working_on','')) > 240
    OR jsonb_typeof(profile_data->'interests') IS DISTINCT FROM 'array'
    OR jsonb_array_length(profile_data->'interests') > 8
  THEN RAISE EXCEPTION 'Check your profile details.' USING ERRCODE='22023'; END IF;
  SELECT array_agg(DISTINCT value) INTO selected FROM jsonb_array_elements_text(profile_data->'interests');
  IF NOT coalesce(selected,'{}') <@ ARRAY['vibe_coding','software','ai_ml','design','content','hardware','business','exploring']::text[] THEN
    RAISE EXCEPTION 'Choose interests from the list.' USING ERRCODE='22023';
  END IF;
  INSERT INTO buzz.member_profiles(account_id,username,display_name,interests,working_on)
  VALUES(member,handle,btrim(profile_data->>'display_name'),coalesce(selected,'{}'),btrim(coalesce(profile_data->>'working_on','')))
  ON CONFLICT(account_id) DO UPDATE SET username=EXCLUDED.username,display_name=EXCLUDED.display_name,interests=EXCLUDED.interests,working_on=EXCLUDED.working_on,updated_at=now()
  RETURNING to_jsonb(member_profiles) - 'account_id' INTO result;
  RETURN result;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'That username is already taken. Try another.' USING ERRCODE='23505';
END $$;
REVOKE ALL ON FUNCTION public.creatorhive_profile(text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.creatorhive_profile(text,text,jsonb) TO authenticated;
