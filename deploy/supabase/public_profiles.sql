-- Apply explicitly after SQLx 0033, member_profiles.sql and moderation_profiles.sql.
-- The web browser cannot read any of these tables or call the resolver function.
REVOKE ALL ON buzz.profile_pages,buzz.profile_images FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION buzz.profile_pulse(UUID,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON buzz.profile_pages,buzz.profile_images TO buzz_backend;
GRANT SELECT ON buzz.member_profiles TO buzz_backend;
GRANT EXECUTE ON FUNCTION buzz.profile_pulse(UUID,TEXT,TEXT) TO buzz_backend;
CREATE POLICY backend_profile_pages ON buzz.profile_pages FOR ALL TO buzz_backend USING(true) WITH CHECK(true);
CREATE POLICY backend_profile_images ON buzz.profile_images FOR ALL TO buzz_backend USING(true) WITH CHECK(true);
-- Managed profile RPCs are SECURITY DEFINER; the relay's joins are not. Give the
-- backend an explicit read policy, never a browser policy, for claimed handles.
CREATE POLICY backend_public_profile_identity ON buzz.member_profiles FOR SELECT TO buzz_backend USING(true);
