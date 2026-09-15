# CreatorHive accounts

Legacy Buzz deployments use a username and password to create an account, sign in on another device, and change their password. Existing members create a login in **Your account**; the messaging identity, history, community membership and roles are retained. Administrators resolve registered usernames when granting access. Account creation itself never grants community admission or a role.

## Managed CreatorHive login

Managed mode supports Google through Supabase PKCE and email/password. The supplied split-screen
component is adapted in `web/src/shared/ui/sign-in.tsx`, alongside the existing UI
components; no new shadcn structure, packages, or fonts are needed. The mascot and
wordmark are centered above the email/password form, account creation and recovery links,
and Google alternative. Keep Supabase's Google and Email providers enabled.
Email is the sign-in identifier; this does not reuse legacy Buzz usernames.
Legacy Buzz deployments remain separate behind `VITE_MANAGED_ACCOUNTS=false`.

Validation September 15: web checks/typecheck and production build passed; all six
onboarding tests and six managed-account tests passed (the unrelated SSO test remains
skipped). Desktop/mobile rendering was reviewed, keyboard button focus and reduced motion
checked, and the live localhost button reached Google's account chooser and returned
successfully. This verifies the handoff, not a new completed account login. Supabase's
public settings confirm both Google and Email enabled. Email rejection, registration
and recovery transport are covered with mocked Auth responses; this UI check does not
create a real user or change an existing password. These UI changes are local and have not been published to production.

The workshop artwork is `web/public/creatorhive-workshop.png`, generated with the
built-in image tool (no selectable model ID was exposed). The original mascot stays
`web/public/creatorhive-logo.png`. Login uses the supplied inset image layout; onboarding
shares the artwork. Mobile login follows the supplied form-only layout. Both respect
reduced motion and retain native keyboard controls.

<details><summary>Image generation prompt</summary>

Use case: stylized-concept. Asset: real CreatorHive web application login background artwork, not a screenshot or UI mockup. Create a premium cinematic 3D illustration of a miniature creative workshop suspended in darkness: an architectural honeycomb of warm amber glass and softly illuminated golden hexagonal chambers, a few tactile workbenches and screens, tiny abstract maker silhouettes collaboratively building, restrained sage/teal accents, beautiful physical materials, subtle atmospheric grain. Strong sculptural honeycomb form occupying center-right, with dark charcoal negative space at left and top. Sophisticated Apple product-film lighting, community workshop spirit, inviting and quiet rather than cyberpunk. Wide landscape composition, full bleed, crisp art direction. No text, letters, words, logos, UI controls, watermarks, badges, or fake interface. This artwork will sit behind real accessible HTML and the original CreatorHive logo.

</details>

## Legacy accounts implemented locally

- `0030_community_accounts.sql`: community-scoped, case-insensitive unique usernames, unique identity linkage, Argon2id password verifiers, encrypted backups, durable attempt quotas and hashed device sessions. No existing identity, membership or message rows are rewritten.
- HTTP-only `/api/accounts/register`, `/login`, `/password`, `/logout`, `/resolve`. Passwords are never Nostr events. Registration and password changes require signed ownership proof covering the entire body. Password changes additionally require the current password. The lookup endpoint requires an existing community owner/admin.
- Passwords: minimum 15 characters, maximum 256 UTF-8 bytes. Argon2id uses the existing dependency's default memory-hard parameters. At most four password operations run per process; cancellation does not release capacity until hashing finishes.
- Browser Web Crypto encrypts the existing messaging identity using PBKDF2-SHA256 (600,000 iterations) and AES-256-GCM, random salt/nonce and a username-bound envelope. The server returns the envelope only after verifying credentials. This preserves the Nostr event protocol internally without asking members to create, copy or manage keys.
- Device sessions: 32 random bytes, only SHA-256 hashes stored server-side, 12-hour expiry. Password changes revoke every prior session atomically. Logout revokes the current session. Session creation locks the account row and verifies the password-hash version, preventing a racing old-password login from creating a session after rotation.
- Migrated accounts require a valid session in addition to their messaging signature. HTTP guard covers NIP-98, Blossom (including URL-safe base64), git and development X-Pubkey requests. Main WebSocket checks at authentication, before each frame and every five seconds while idle. Huddle audio checks at admission and every five seconds. Database errors deny access. Delegated agents also need their credential owner’s valid session, so generating a new agent key cannot bypass password login. Authentication session tags are rejected by the shared event-storage path.
- Invite links offer the same username/password signup and login, then claim the original invite with body-bound signing and the account session. Consent and age checks remain required, unavailable policy fails closed, and exhausted/expired invites keep the member on the invite page. Navigation into chat preserves the in-memory login. Existing browser profiles and desktop-app invite/download options remain supported. Join-policy and acceptance requests use the configured relay, matching the claim and account tenant.
- Secrets, session tokens and passwords remain in page memory. Reloading/closing the page requires signing in again. Sign-out clears private query/profile/media caches. Existing unmigrated browser identities continue working until their owners create logins; successful migration removes the old localStorage secret.

## Deployment requirements and limits

Publishing this source branch does not deploy the account system. Lucas must coordinate the relay migration, frontend, and external service session integration before enabling credential accounts in production. The relay advertises account support through its capability document; existing browser identities remain supported.

Use HTTPS, configure the relay's existing CORS allowlist for the actual app origin, and route `/api/accounts/*` to the relay without request-body/authentication-header logging or caching. Vite proxies these paths only during local development. The relay advertises `creatorhive-accounts-v1` in its capability document.

Attempt limits are shared in Postgres: 15 per normalized username and 60 per direct peer IP in 15 minutes. Forwarded IP headers are not trusted. Behind a reverse proxy the IP quota is shared by that proxy; establish a trusted-proxy policy before scaling beyond that quota. No proxy-header guessing is implemented.

Password-reset email, account recovery, remember-me cookies, username changes and a staff account-recovery process are not implemented. Members must retain their password. A forgotten password cannot decrypt the backup. Do not promise account recovery or deploy a reset flow that silently replaces someone's identity. External stagekeeper/agentkeeper services and other clients need the new session integration before they can act for a migrated account; service/bot identities without credential accounts retain existing authentication.

## Verification

Run `pnpm --filter buzz-web build` and the Playwright `accounts.spec.ts` alongside community access/UI, Markdown and Live tests. Browser fixtures exercise real Web Crypto, signatures, login on fresh page state, identity-preserving migration, password rotation, missing membership, tampered backups, invite consent via keyboard, signed claims, failed-claim retry, and invite-to-chat session continuity without contacting the real relay.

Run `BUZZ_TEST_DATABASE_URL=<isolated migrated Postgres> cargo test -p buzz-relay api::accounts::tests --lib -- --include-ignored`. These tests exercise real SQL, Argon2id, NIP-98 proof, durable login, tenant isolation, uniqueness, role boundaries, session revocation and a real TCP WebSocket connection. Never point destructive migration tests at a real community database.

Crypto references: [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [Web Crypto key derivation](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey).

### Verified in this checkout

- Full `just ci` passed after installing the existing pinned desktop dependencies: workspace/desktop Rust checks and tests, 4,535 desktop JavaScript tests, desktop/web production builds, and 1,261 mobile tests.
- All 38 web browser tests passed, including credential invitation signup/login, consent, failed-claim recovery, session-preserving navigation, and both homepage entry states. Login, account settings and invites were visually reviewed at 1440px and 390px. Web checks and the production build passed after the invite changes.
- Three account tests passed with real isolated Postgres, including tenant isolation, credential-owner checks for delegated agents, auth-token storage rejection, and live WebSocket revocation.
- The upgrade test preserved a preexisting owner and private channel and did not invent credentials. DB unit tests passed (94; 155 infrastructure tests ignored).
- `just test` unit groups passed; its standard integration stage could not start because the Docker daemon was unavailable. This is separate from the passing isolated account/SQL/WebSocket tests above.
- Temporary Postgres was stopped. The existing localhost:5173 preview remains running against the current hosted backend. No production accounts or roles were changed.


## Community welcome

The presentation now adapts [Cult UI's Onboarding primitives](https://github.com/nolly-studio/cult-ui/blob/main/apps/www/registry/default/ui/onboarding.tsx) in `web/src/shared/ui/onboarding.tsx` (MIT notice retained). It uses the supplied centered panel, header, step indicator and navigation composition, with a controlled three-step profile/username/interests flow after authentication. Native checkbox tiles preserve multiple interests rather than changing them into the reference's single-select radio group. The page uses CreatorHive’s inherited sans-serif typography, charcoal surfaces, a workshop detail within the panel header, gold accents and a framed avatar picker. The username has its own claim screen, separate from the photo/display-name fields. The surrounding scene is restrained so the form stays prominent. Step transitions honor reduced motion. No new dependency, feature-tour carousel, extra account step or database migration is introduced by this presentation change.

Account creation comes first (Google, or verified email/password). `/onboarding` then asks for a profile, a separate username claim, and optional interests. Managed members choose a unique lowercase @username, display name and optional photo. Usernames are community handles, not login credentials; Google members never need another password. Existing members can edit these choices through **Your account → Revisit the community welcome**.

`deploy/supabase/member_profiles.sql` stores canonical handles, names and private preferences in `buzz.member_profiles`. The narrowly scoped `public.creatorhive_profile` RPC reads only the caller's record, checks availability, and saves it. A database unique constraint handles concurrent claims; client availability checks are advisory. The RPC checks verified, unrevoked first-party sessions and rejects OAuth client tokens. Browser roles have no direct table access. Apply it after `auth_integration.sql`; the SQL regression script uses temporary accounts inside a rolled-back transaction.

**Claim username** immediately saves the canonical handle through the existing profile RPC. Availability is advisory, not a reservation; only an accepted save displays the success pulse/checkmark and unlocks Continue. The claim survives leaving onboarding and is loaded on return. Changing to another handle releases the previous name through the same atomic update. The UI makes no unverified rarity claims, has no countdown or sound, and honors reduced motion.

**Enter the Hive** saves the remaining private profile preferences, uploads a selected photo through the existing authenticated media path, publishes name/photo through the existing kind:0 profile helper, and records completion in Supabase user metadata. Existing profile fields are preserved. An interrupted read refuses an overwrite. Failed steps retain the form for retry; an uploaded photo is reused if only completion fails. JPG, PNG and WebP uploads are limited to 5 MB here. Google photos are imported only on an explicit click and copied into CreatorHive media storage; arbitrary external profile images are not rendered.

Interests and “What are you working on?” are optional and never posted to chat. Completing the flow opens accessible General (or another accessible public channel) with a private, dismissible welcome suggesting accessible channels and Live/Pulse. It does not post an introduction, join channels, change roles or grant paid access. The welcome banner is tab-local; canonical preferences survive browsers. The completion metadata controls navigation only, never permissions.

Legacy deployments retain the name/photo path without claiming username uniqueness; they do not persist interests to Supabase. Managed deployments require the profile migration before releasing this frontend. Browser tests cover both modes, keyboard operation, responsive layout, invalid/taken usernames, photo import, save retries, private preferences and denied membership. The separate SQL check covers ownership, duplicate handles and session revocation.
