# Public profiles

Route: `/@username` (no auth gate or channel subscriptions), plus lazy profile
previews and a member-only editor modal opened from account settings or profile
cards. The old `/profile/edit` URL redirects to chat. Search in the
member panel resolves claimed usernames on the server, never from kind:0 metadata.

Profiles start unpublished. New-member review is enabled with
`VITE_PUBLIC_PROFILES=true` only after the corresponding relay is ready. Existing
members must open Edit public profile and save. Onboarding preferences never
populate the public interests/bio automatically. Handles still use the existing
unique PostgreSQL claim; old URLs are not redirected after rename.

## Backend contract

- GET `/api/profiles/:username`: strict public projection; optional first-party
  Bearer session enables members-only pages and member actions. Anonymous output
  excludes the internal messaging key. The gate does not start a Buzz session.
- POST `/api/identity/profile/own`, `/save`, `/search`: active first-party session,
  current community membership, and host-derived tenant. Save validates field
  limits, URLs, ownership, moderation policy, images and Pulse references.
- POST `/api/identity/profile/image`: at most 5 MB of PNG/JPEG/WebP. The existing
  image dependency decodes with allocation/dimension limits, shrinks to 1600px,
  and re-encodes JPEG without metadata. A UUID variant is written under
  `profile-variants/<community>/<uuid>.jpg` in retained media storage. No remote
  image fetching, Supabase Storage, or widening of Blossom permissions.
- GET `/api/profile-images/:uuid`: checks current profile publication, reference
  and visibility on every request. Owners may preview their own pending uploads.
  Objects must remain private at the storage origin. Responses, including API
  errors, use no-store; no signed URLs outlive a visibility change.
- Selected Pulse root notes are resolved fresh from the event store. Only owned,
  non-channel, non-reply notes qualify. Author edits are reflected, deleted or
  moderated notes disappear. No raw tags, attachments, replies or reactions are
  serialized. Profiles are hidden for banned members and active rename holds.
- Profile reports use the existing kind:1984 moderation pipeline. Message/report
  actions bootstrap the managed identity on demand, not during public browsing.

## Explicit preview rollout

1. Run the normal migration exporter to preserve SQLx checksum tracking; apply
   migration 0033 to the private buzz schema. Do not manually apply schema.sql.
2. Apply `deploy/supabase/public_profiles.sql` after the account and moderation
   integration scripts. It installs backend-only grants/RLS policies. Ensure the
   community word policy is installed and retained object storage is private.
3. Deploy the relay with `BUZZ_PUBLIC_PROFILES=false` (default), and the frontend
   with `VITE_PUBLIC_PROFILES=false` (default). Existing onboarding is unchanged;
   the editor can save drafts. The Cloudflare router source includes the new
   page routes; deployment is separate.
4. Rehearse with disposable accounts and images in an isolated preview. Verify
   Google/email session refresh, private/public switches, media denial, bans,
   rename holds, reports, DM opening and account switching against the real
   relay. No production accounts are needed for automated tests.
5. Only after rehearsal, set `BUZZ_PUBLIC_PROFILES=true` on that preview and
   rebuild with `VITE_PUBLIC_PROFILES=true`. The server switch also disables all
   anonymous profile/image reads immediately if turned off. Never remove the
   publication gate merely to make the screen appear.

## Validation

`pnpm --dir web check`, `pnpm --dir web build`, and
`pnpm --dir web exec playwright test --config playwright.managed.config.ts`
include profile navigation, no anonymous auth/chat traffic, retry, save failure,
ordering, privacy selection, and desktop/mobile renders. Browser fixtures are
synthetic; they are not proof of deployed authentication or storage behavior.

`PROFILE_ONBOARDING_TEST=1 pnpm --dir web exec playwright test --config playwright.profiles.config.ts` runs the profile suite and enabled onboarding review on its own port.

Rust tests: `cargo test -p buzz-relay api::public_profiles`,
`cargo test -p buzz-media profile_tests`. The ignored buzz-db test
`profile_privacy_and_source_ownership` requires
`CREATORHIVE_PROFILE_TEST_DATABASE_URL` pointing to the isolated local
`creatorhive_public_profiles` database with a test auth fixture. It checks actual
PostgreSQL publication, ownership, source edit/delete, rename and ban behavior.

Unattached uploads remain private. The initial version deliberately does not
add a background deletion service; include unreferenced profile variants in the
existing storage retention review before increasing upload volume. No followers,
public directory, SEO indexing, arbitrary themes, or new project system.
