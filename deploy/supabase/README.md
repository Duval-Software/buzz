# CreatorHive account replacement — release record

**Target:** existing Ohio project `olgskffmtievlhibuhpk`, CreatorHive Pro organization
`soflfxdyupwahrokfyfs`. The Virginia replacement was deleted by Sean. Do not recreate it.
**Release status:** implementation and database preparation; not a production cutover.
The current Hetzner deployment remains on its original database and authentication.

## September 15: member onboarding profiles

`member_profiles.sql` is applied to the Ohio preview project. Apply it after
`auth_integration.sql` when provisioning another environment; it is separate from
immutable SQLx migrations and their checksum ledger. No production frontend was
released as part of this change. The dedicated username step now commits through
the same RPC immediately on **Claim username**; the member does not have to finish
onboarding to retain the handle. Availability checks alone never reserve a name.

The private `buzz.member_profiles` table holds one canonical username per account,
with a unique lowercase constraint, display name and optional private interests/project
answer. Browser roles cannot access it directly. The narrow `public.creatorhive_profile`
RPC derives the caller from their JWT and checks the existing live-session helper;
OAuth app tokens, revoked sessions and cross-account session pairs are refused.
No user-supplied account ID is accepted. Usernames are handles, not login credentials.

`verify_member_profiles.sql` passed against the live preview database in a rolled-back
transaction: own-record isolation, duplicate/reserved handles, invalid interests,
revocation, OAuth-client denial and direct table privilege checks. Test records did
not remain. Existing users need not redo completed onboarding; **Revisit the community
welcome** lets them add a handle and edit private preferences.

Validation: web source checks and production build passed, all 75 web smoke tests
and all six managed-account browser tests passed. Desktop, tablet and mobile
onboarding renders were reviewed. Auth/media browser tests use synthetic services;
the profile SQL checks ran on the real preview project. Full production cutover
and real-user completion of this revised profile flow are still pending.

## September 15: relay access verified, media access pending

Sean's dedicated public key is installed in root's authorized_keys on
creatorhive-01 (87.99.157.94). A strict SSH connection with that key returned the
expected hostname. Its ED25519 host fingerprint was independently checked against
the authenticated Hetzner console:
`SHA256:fcH/rKFX7zTcM3ydeUlpSvSaW1nTu3PIVucR1mRYwN4`.
The verified host entry is in Sean's local `~/.ssh/creatorhive_known_hosts`.
No root-password SSH settings were changed. Media console authentication with
the supplied credential failed; direct user login is pending.

Read-only relay inspection confirmed:
- Compose project `buzz-prod`, files `/opt/buzz/deploy/compose/compose.yml` and
  `/opt/buzz/deploy/compose/compose.caddy.yml`, with `.env` in that directory.
- Relay image `buzz:relay-multi-fanout`, image ID
  `sha256:3f6a8935f61c29680eba5e3ec15be27d96896e7fa62147115d5dc0a8cf072a83`.
- Production PostgreSQL 17, Redis 7, MinIO, Caddy and pair relay are local containers.
- Resident agent, greeter, guard and glass-sidecar systemd services are active.
- Database still targets local `postgres:5432/buzz`; automatic migrations are enabled.
- Relay CORS configuration contains only `https://chat.creatorhive.ai`.
- Host connects to the Ohio Supabase direct PostgreSQL endpoint as `buzz_relay`
  with TLS certificate and hostname verification; `verify_database.sql` passed.
- `/opt/buzz` checkout is at `0ec8a930cb9a6c32a4c4be3248438757123072ce`, with a
  locally modified Caddyfile. Preserve that deployed configuration.

A private configuration backup (including environment secrets) is stored outside
the repository at `~/.local/share/creatorhive/deploy-backups/2026-09-15/creatorhive-01-config.tgz`
with mode 600. This is not a database or media backup. No production services were restarted,
no database URL was changed, and no production cutover occurred.

An isolated Linux build passed in container `creatorhive-preview-build-20260915`
from `/opt/creatorhive-preview/20260915/source`, with two CPUs, 4 GiB memory and
512-process limits. It builds the current working-tree relay and admin binaries;
it does not mount production configuration or volumes, publish ports, or start a relay.
Exit status was zero. The relay binary SHA-256 is
`4e7f11c88f4cc4482fb0219bc56860386dade7239e9beecf06fcb44bdaf3c018`.
The first compilation stopped on AppleDouble `._*.sql` files from macOS tar.
Those generated metadata files were removed from the isolated source directory,
and the same cached build was restarted with the managed-owner startup fix.
For subsequent archives, use `COPYFILE_DISABLE=1 tar --no-xattrs` to omit metadata.

Latest checks: web source checks and production build passed; five managed-login
browser tests and five relay managed-signing tests passed. Desktop and 390px mobile
login screenshots were reviewed. The optional reference-app browser test was skipped
because its service was not running. The managed Playwright configuration now builds
with its mock Auth origin itself, avoiding stale or production-configured test bundles.

The restricted runtime password is now configured. Its random plaintext is in
protected files outside the repository on Sean's Mac and the preview server;
only its PostgreSQL SCRAM verifier was sent through MCP. The role remains bounded
to 30 connections with no superuser, schema-creation or auth-schema privileges.
The CA was obtained from the certificate URL in
[Supabase Studio's own configuration](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json).
It is installed at `/opt/creatorhive-preview/certs/supabase-ca.crt`; its SHA-256 is
`807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa`.
TLS 1.3 certificate and hostname verification passed before the authenticated SQL check.

`localhost:3300` is the isolated preview community, ID
`6ea40f06-96a3-4b49-aff1-c9495a8d0cc0`. General and Announcements are seeded,
with Announcements restricted to admins. Re-running the seed script inserted zero
duplicate rows and passed its policy check. The script now matches the existing
`lower(host)` unique index. Sean's verified Google account now has exactly one
managed identity and ordinary `member` access; no staff authority was assigned.
Anonymous Data API attempts against `buzz.events`, `buzz.managed_accounts` and
`buzz.hosted_agents` were rejected with `406 PGRST106` (schema not exposed).

Preview Redis and MinIO are healthy and storage initialization exited successfully.
They use the separate `creatorhive-preview` Compose project, network and volumes.
`preview.compose.yml` merges with the existing Compose file, removes the local
PostgreSQL dependency, mounts the built binary and CA, and binds the relay only to
`127.0.0.1:3300`. The new relay is running against Supabase. The isolated bridge
has IPv6 enabled so direct PostgreSQL works without changing production networking.
Use `RELAY_URL`, not `BUZZ_RELAY_URL`, for the relay's native configured address.
Google and email providers remain enabled. Real Google sign-in was completed in
Chrome on September 15: Supabase confirms Sean's verified Google account and one
active session. Cancellation also returned safely to the login page. Real onboarding
saved Sean's profile, entered the community, and posted a test message in General;
the message was independently verified in Supabase and remained visible on reload.
Real sign-out removed both Supabase and managed relay sessions while preserving the
identity; Google sign-in restored the same account, profile and ordinary member role.
Initial channel selection now waits for completed history and prefers General,
with a delayed-history browser regression covering both default entry and DM links.
Announcements has no member composer. Google Cloud audience is still Testing, with
Publish disabled until branding configuration is complete. No public privacy-policy
link was found on the existing homepage; Sean was asked for an existing policy or
permission to prepare a review draft. No policy or legal terms were invented/published.

The managed web preview is running on `http://localhost:5173/chat`, with an SSH
tunnel from `localhost:3300` to the preview relay's loopback port on creatorhive-01.
Vite now sends uploads to the configured relay, and managed-mode keeper requests
stay on the preview relay unless `VITE_KEEPER_URL` explicitly selects a keeper.
The routing check runs as part of `pnpm --dir web check`. Production build and
all five managed-login browser tests passed after this change.

Managed startup no longer requires or promotes a legacy `RELAY_OWNER_PUBKEY`,
and skips legacy allowlist admission. Staff authority comes only from the verified
account bootstrap procedure. The focused startup test passes; legacy startup
still requires its configured owner when membership enforcement is enabled.

### Hosted-agent preview (September 15)

Apply `hosted_agent_admission.sql`, `hosted_agent_ownership.sql`, then
`agentkeeper_role.sql` after the account schema. The registry transaction admits only
ordinary members and records ownership in Buzz's existing `users` table, with
`owner_only` channel invitations. It never auto-joins channels. Paused/deleted agents
and agents whose owner is removed, banned or unverified fail managed authentication.
Managed mode rejects legacy key adoption and unauthenticated local identities.

The separate `buzz_agentkeeper` login is limited to four connections and cannot read
chat, Supabase accounts or member signing keys, or directly grant relay membership.
`verify_hosted_agents.sql` passed with rollback, including shared ownership and channel
policy. `verify_keeper_role.sql` passed as the actual restricted TLS login again after the
ownership addition. Agentkeeper startup requires both admission and ownership triggers. The real registry
persistence/conflict/outage Go test passed on disposable TLS PostgreSQL 17.

`preview-keeper.compose.yml` runs agentkeeper on host loopback 8092 and a Caddy session
validation proxy on loopback HTTPS 3343. The latter forwards only to the isolated relay.
Its one-day local CA/leaf certificate is preview-only and must be renewed for a later
rehearsal; it is not installed in the system trust store. Protected database, service
and encryption settings remain outside Git. Vite selects this keeper explicitly with
`VITE_KEEPER_URL=http://localhost:8092` through an SSH tunnel.

Creating Preview Echo in real Chrome successfully persisted an encrypted registry row,
admitted the agent and authenticated its relay connection. The subsequent owner-signed
roster publication failed because the old admission trigger did not populate Buzz's
ownership row. `hosted_agent_ownership.sql` repairs that cause and existing registry
rows without replacing conflicting ownership. After unlocking, Chrome loaded the existing agent under My cloud agents and successfully
created its private two-member DM. The new DM did not appear in the current discovery
subscription until a browser reload; its URL initially rendered General instead. Fix that
discovery/navigation race before acceptance. An owner test message was accepted in the DM;
Echo reply and pause/resume/delete remain unverified.

## Current scope: Google login activation, backend deployment pending

After the initial database-only preparation, Sean requested Google login activation.
The Google OAuth client is now created and Supabase's Google provider is enabled.
Managed login now passes the real isolated relay/browser flow. Shared login and
keeper changes below still require deployment and acceptance. Keep production
frontend managed-account flags disabled until the coordinated release gates pass.
Managed hosted-agent admission is integrated with the registry in the isolated preview;
its end-to-end messaging and lifecycle acceptance remains pending. Do not enable production
managed mode based on the database being ready.

The existing Ohio database has all 31 SQLx migrations. `relay_role.sql` prepares a
dedicated `buzz_relay` login with the private schema search path and bounded connections.
Its restricted login has now passed a real connection test from Hetzner.
Use `preview.env.example` for the managed-account rehearsal; `database.env.example`
documents only the earlier database-only phase.
Live MCP verification confirmed all 31 checksums match the local SQL files and
the runtime role has event-table access but no schema creation or `auth` access.
The separate `psql` verification and healthy preview relay prove the runtime network
login. All observed runtime PostgreSQL connections use TLS; the role's connection
limit is 30. The relay also maintains separate bounded audit/search pools.

Additional September 15 rehearsal results:
- On a separate disposable PostgreSQL 17 container, all 31 migrations and
  `buzz-admin maintain-partitions` completed. The existing future catch-all partitions
  cover the current months; this does not prove monthly scheduler installation.
- `concurrent_bootstrap_never_duplicates_or_restores_removed_members` passed:
  concurrent identities converge, initial role is member, revoked tokens and replayed
  signing requests fail, and removed memberships are not restored by login.
- `announcement_publishing_enforces_roles_and_alternative_paths` passed through real
  database-backed ingestion, including member denial and authorized staff publishing.
- `active_websocket_requires_and_rechecks_credential_session` passed: a missing session
  cannot authenticate, private session tags cannot be published as content, and revoking
  the session closes an established socket. This transport fixture uses legacy credential
  accounts; managed database authority and real Google logout were verified separately.
- `verify_auth.sql` passed against Ohio through MCP. Its synthetic rows were rolled back;
  it checks verification, bans, expiry/revocation, private-schema permissions, OAuth-client
  isolation, cross-community denial and revoked grants.
- `go test ./...` passed in `glass-hive`; both reference-app PKCE/OIDC unit tests passed.
  These do not prove the pending media deployment or a real shared-login consent flow.

The disposable test database and its SSH tunnel were removed after testing. Preview
and production relay containers remained healthy. No production configuration changed.
The Resend key is stored privately outside Git in `~/.local/share/creatorhive/preview/resend.env`.
Resend verified `creatorhive.ai` and all DKIM/MX/SPF records on September 15. After Sean
saved SMTP, Chrome confirmed custom SMTP enabled with CreatorHive / noreply@creatorhive.ai,
`smtp.resend.com:465`, username `resend`, and a 60-second per-user interval. Supabase's
recovery request succeeded; Resend confirmed delivery to Sean at 18:17:58 UTC, email ID
`ac4cc999-356c-43fb-86fa-f018515cc28e`. No password was changed and recovery completion
still needs a browser test. This proves Supabase-to-Resend delivery, not production cutover. Google publication, media access, agent lifecycle acceptance,
recovery completion, owned-app OAuth, backup restoration and cutover remain open gates.

1. Runtime credentials are prepared in `/opt/creatorhive-preview/relay-database.env`
   and the protected preview `.env`. Preserve their private copies outside Git.
2. The project's CA certificate and verified direct connection are prepared.
   Use the dashboard's session connection if the host cannot reach direct IPv6.
   Run `psql "$DATABASE_URL" -f deploy/supabase/verify_database.sql` from the
   protected operator shell to verify TLS, runtime identity, schema and table access.
3. First validate with a separate Buzz process and Redis namespace/instance. The
   empty database still needs a community for its exact hostname, channel seeding,
   and the existing account admission configuration. No old data is copied.
4. Verify chat, search, memberships and restart before changing the production
   relay's database URL. Schedule `buzz-admin maintain-partitions` using the
   operator DDL connection; the runtime role cannot create partitions.

The repository's generic Compose file explicitly overrides `DATABASE_URL` with
its local Postgres service. Merely adding an env-file value does not switch that
deployment: update its relay environment override and Postgres dependency in the
actual deployment configuration once that configuration has been inspected.

## Prepared through Supabase MCP

- Private `buzz` schema, original SQLx migrations 0001–0030 with their original SHA-384
  checksums, and new migration 0031 for managed identities, sessions, replay records,
  and the empty hosted-agent registry. No users, messages, agents, credentials, or media migrated.
- `auth_integration.sql`: live verified-account/session checks and a backend permission group.
- `owned_apps.sql`, then `owned_app_scopes.sql` and `owned_app_moderation.sql`: manually approved client registry and a
  narrowly scoped `public.creatorhive_membership` RPC. Requires the exact OAuth client,
  user/session, active consent, issuer-validated JWT, and `openid email profile` access.
- `lock_function_paths.sql`: legacy function/trigger lookup pinned to private `buzz`.
  Original SQLx migration files were not rewritten.
- `verify_auth.sql` passed against Ohio and rolled back all synthetic account/client/session
  records: active account, unverified/suspended/expired/revoked denial, private-data grants,
  native-token rejection at the app RPC, approved app profile access, current community bans,
  expired bans, removed memberships, missing scope,
  cross-community access, OAuth-session rejection by signer authority, and consent revocation.

The security advisor's public SECURITY DEFINER warning for `creatorhive_membership` is
intentional: its checks are the approved-app boundary; callers have no `buzz` access.
See [the advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
The nine legacy mutable-search-path warnings were addressed separately.

`export_migrations.py` exports MCP arguments for a **fresh** schema only. Do not replay it
against the prepared Ohio database. The SQLx ledger makes duplicate application fail.
Never apply `schema/schema.sql` as well. New SQLx migrations must be applied explicitly,
then any Supabase-specific integration migration, before replacing runtime services.

## Local implementation

- Web uses Supabase's PKCE client, Google plus email/password entry, registration,
  recovery, refresh, consent, and Connected apps. Both providers were verified enabled
  September 15 after Sean chose to retain email/password. SMTP remains configured.
  Managed mode cannot import/export/generate
  a member key or fall back to an anonymous identity. Handles remain profile data.
- Relay provisions one encrypted identity per `(community, account)` under a DB transaction;
  concurrent callbacks converge on one key. It admits only a new ordinary member, does not
  restore removed access, and repairs relay-signed channel/membership discovery before entry.
- AES-256-GCM envelopes bind the community, account, public identity, and key version.
  Master keys are external to PostgreSQL. CreatorHive operates signing authority; this is
  **managed custody**, not self-custody.
- `/api/identity/bootstrap`, `/sign`, `/logout`: current Supabase user verification AND
  private active-session checks. OAuth client tokens are refused. Signing checks event
  kinds, age, tags, destinations, references, channel permissions, ownership, rate limits,
  and request replay. Existing event ingest remains the final mutation authority.
- HTTP, WebSocket and Blossom use the shared account-session gate. Retained services use
  `/api/identity/session` with a separate service secret, signed member proof, and live DB
  authority. It returns only an access decision, never keys or profiles.
- `glass-hive` uses TLS PostgreSQL for encrypted agent records in managed mode, a bounded
  pool, and stale-writer rejection. Failed writes restore in-memory state. Existing agent
  secretbox encryption remains; `AK_MASTER_KEY` still needs independent backup.
- Stagekeeper checks lobby tokens on every request and live participant proofs during its
  existing enforcement loop. Managed media identities are distinct per issuance. Proofs
  stay server-side, never in participant metadata. Revocation/database failure denies access;
  actual LiveKit eviction timing still requires the deployed rehearsal.
- `sso-demo` is a separate Node reference service: authorization code + PKCE, state and nonce,
  asymmetric issuer/audience/expiry verification, server-held refresh tokens, and live
  membership/consent verification on every authenticated request. No billing or chat access.
- Text drafts survive account retry/remount and refresh within the same browser tab, scoped
  by relay, member, and destination. Chat/DM/thread text clears only after acknowledgement.
  Uploaded attachment draft metadata and Pulse composer options are still page-local.

## Evidence so far

September 15 final-check checkpoint: `just ci` passed formatting, clippy, web/mobile
source checks, unit checks, desktop JS tests/build/checks, then stopped at the unchanged
`generated_passphrase_respects_word_count_and_separator` desktop Rust test (2,269 passed,
one failed, 14 ignored). The test splits on `-`, but the random EFF word list contains
`yo-yo`; the isolated retry passed. This is not a clean full-CI result. The remaining
`just web-build mobile-test` passed separately (1,261 mobile tests). Logs are local at
`/tmp/creatorhive-final-ci.log` and `/tmp/creatorhive-remaining-ci.log`.
`glass-hive` Go tests/vet and the two reference-app token tests passed again.
Live unauthenticated bootstrap, signing and service-session requests return 401.


- Existing `just ci` passed during implementation; final changes are rechecked before handoff.
- All 75 existing web browser tests passed after the draft-preservation fix.
- Managed web browser tests cover desktop/mobile entry, Google PKCE request construction,
  failed login/recovery, reload preserving the same public identity, no browser private key,
  and draft preservation/retry when the signing service refuses a message. Providers and
  relay traffic are mocked in these tests; they do **not** prove live Google/SMTP.
- Real isolated PostgreSQL: concurrent provisioning, member-only admission, removed-member
  protection, token/session binding, request replay, and channel discovery query passed.
- Real isolated TLS PostgreSQL: agent registry reload/decryption, competing writer rejection,
  update/delete failures and in-memory rollback passed.
- Go service tests and vet passed; reference OIDC tests cover invalid state, nonce, issuer,
  audience, client ID, expiry and one-use transactions.
- `just test` could not complete its Docker-backed integration stage: Docker's engine
  stopped responding after startup. The test attempt was stopped; its unit stage passed.
  Do not call full relay integration complete. Database preparation uses Supabase MCP.
- Database backup restoration, partition rollover, real OAuth redirects/consent/revocation,
  actual email delivery, live uploads/LiveKit/agent lifecycle and
  deployed database-outage behavior remain acceptance gates.

## Operator access needed (plain language)

Supabase MCP can prepare and inspect the database. It cannot install the replacement relay
or keepers on Hetzner, and this MCP has no Google/SMTP/OAuth-server configuration methods.

Sean or Lucas needs to provide an existing way for this Mac to deploy to the two servers,
with verified server fingerprints, or have Lucas run the prepared deployment steps. No
private key or password should be pasted into chat. Also needed: Google Cloud OAuth client
administration, Resend SMTP/verified sender configuration, Supabase Auth settings, and DNS.
Do not bypass SSH host verification or use an unrelated computer's deployment key.

## Provider configuration

### Google provider connected September 14, 2026

- Google Cloud project: `creatorhive-508618`.
- Web OAuth client: `CreatorHive Web — Supabase`.
- Client ID: `797699584781-mksguvsvi4np5ktn5ehnh55hmrjbis25.apps.googleusercontent.com`.
- The only authorized provider redirect is
  `https://olgskffmtievlhibuhpk.supabase.co/auth/v1/callback`.
- Client secret was transferred directly from Google's creation dialog to Supabase's
  Google provider through Chrome. No secret was written to source files or this record.
- Provider enabled; nonce checks retained; accounts without email remain disallowed.
- Live `/auth/v1/settings` returned `external.google: true`, email enabled and signups enabled.
- Live `/auth/v1/authorize?provider=google` returned 302 to `accounts.google.com`,
  with the expected client ID and exact Supabase callback. This verifies initiation,
  not completion of an actual Google login or community admission.
- Google reported Testing audience at client creation. Test-user eligibility and
  production publication still need verification. Chrome's accessibility capture
  stopped returning the current page while inspecting Audience; no publication
  action was taken.
- The production relay's `POST /api/identity/bootstrap` returned **404**. Its
  managed-account service has not been deployed. The Cloudflare preview remains
  on the legacy account flow until this service and its database connection work.

September 14 setup progress: the Ohio dashboard now has Site URL
`https://app.creatorhive.ai` and exactly four allowed callbacks: `/chat` and
`/chat?account=recovery` at `https://app.creatorhive.ai` and `http://localhost:5173`.
New signups and email confirmation are enabled; anonymous sign-in is disabled.
Managed-account onboarding now reuses the existing three-step welcome, with
completion stored per relay in Supabase user metadata. Five managed browser tests
and seven existing welcome tests passed, including 390px mobile and failed-save
retry; the web production build passed. Provider/relay tests use synthetic traffic.
Google Cloud configuration is in project `creatorhive-508618`, separate from the
Supabase project identifier. Real Google login and a deployed membership bootstrap
still need verification; do not enable production managed mode until those pass.

1. In the Ohio project's Auth settings, enable email/password with email confirmation.
   Configure Resend SMTP using a verified CreatorHive sender and test verification/reset
   delivery. Keep SMTP credentials out of browser builds. Check abuse limits and production
   email quotas against the intended launch traffic.
2. The Google **web application** OAuth client and Supabase provider are now configured.
   Authorized redirect URI is exactly
   `https://olgskffmtievlhibuhpk.supabase.co/auth/v1/callback`.
   Keep its client ID/secret in Supabase's Google provider settings. Complete Google's
   consent-screen/publication requirements. Do not confuse this provider callback with the
   frontend callback.
3. Supabase Site URL: `https://app.creatorhive.ai`. Allow exact frontend URLs
   `https://app.creatorhive.ai/chat` and `https://app.creatorhive.ai/chat?account=recovery`, plus
   the corresponding explicitly selected preview URLs. Register localhost only for development.
4. Enable Supabase's OAuth/OIDC server with asymmetric signing keys. Authorization/consent
   UI URL points to the CreatorHive web login route. It receives `authorization_id` and
   resumes consent after Google login using tab-scoped state. Disable dynamic registration.
5. Manually register the owned reference app as a public PKCE client (`none` token auth),
   authorization-code and refresh-token grants; exact callback
   `https://sso-demo.creatorhive.ai/callback`. Only request `openid email profile`.
   Record the returned `client_id` in `buzz.owned_oauth_apps` for the seeded community;
   use the service's registered ID, never an invented UUID or direct auth-table insertion.
6. Add DNS/TLS/reverse proxy for `sso-demo.creatorhive.ai` to the existing media/frontend host,
   forwarding to the reference service on loopback port 8788. Preserve the Supabase issuer.

## Isolated preview installation

1. Capture actual deployed commits/images, compose/systemd/reverse-proxy configuration,
   volumes/media locations, Redis settings and backup jobs on:
   - `creatorhive-01` / `87.99.157.94`: chat relay.
   - `creatorhive-media-01` / `178.156.187.44`: app, agentkeeper, stagekeeper and media.
   Keep a recoverable copy of their environment files and key material outside the DB.
2. Run a separate relay/Redis and keepers using preview origins and ports. Do not point the
   existing production relay at the empty Ohio database. Record the selected origins before
   configuring callback, signing-origin and CORS allowlists.
3. Create separate login roles through the supported operator database workflow. Runtime
   relay role inherits `buzz_backend`, has `search_path=buzz,extensions`, bounded connection
   limits, and no schema ownership/DDL. Agentkeeper needs only `USAGE` on `buzz`, `SELECT` on
   `buzz.communities`, and DML on `buzz.hosted_agents`; give it no member-signing-key access.
   Do not place a database password into MCP migration history. Set login passwords through
   a protected operator connection (`psql \password`) or approved secret/deployment tooling.
4. Use direct PostgreSQL over `sslmode=verify-full`; session pool on 5432 is the fallback if
   direct IPv6 is unavailable. Never use transaction pooling/6543. Fetch the project's CA
   certificate through the dashboard. Start with relay pool 10 and keeper pool 4.
5. Populate a protected server environment from `preview.env.example`. Generate separate
   32-byte random member-encryption and service-auth secrets; keep master key versions and
   agentkeeper's master key independently backed up. Reuse neither the Google client secret
   nor a Supabase service-role key as an encryption key.
6. Run `seed_community.sql` with the preview's verified host and relay **public** key before
   the first signup. It seeds only General and Announcements, with admin-only announcement
   publishing. Record the returned community UUID. Use `buzz-admin maintain-partitions`
   under the operator DDL connection now and in the existing monthly maintenance scheduler.
   Keep existing retention/outbox/background workers enabled. Ordinary managed relay startup
   requires `BUZZ_AUTO_MIGRATE=false` and does no partition DDL.
7. Build/deploy both repositories together with their respective managed-auth flags. Start
   the reference service using `pnpm --filter creatorhive-sso-demo start` and its public-client
   configuration. Confirm package name against `sso-demo/package.json` if invoking manually.
8. Lucas and Sean create verified accounts normally; verify their account UUIDs with them.
   Run `bootstrap_staff.sql` with those UUIDs and the community UUID. It assigns Lucas owner
   and Sean admin; it refuses a different existing owner. Re-login to refresh discovery;
   leave `RELAY_OWNER_PUBKEY` unset in managed mode; verified database roles are authoritative. Never grant
   owner/admin to the first signup or to an email string matched without verification.

The stagekeeper and reference app deliberately use bounded in-memory session records for
one process. Restart requires reconnect/login; multiple replicas need a shared private
session store. Media session proofs expire with their bound member session. Validate token
renewal/reconnect UX during rehearsal before choosing the public session lifetime.

## Final acceptance and coordinated release

Run repository checks and production builds, final web suites, relay/database/auth integration,
all `glass-hive` tests, and `node --test sso-demo/*.test.mjs`. Then exercise the complete approved
acceptance list with real preview services: Google/email verification/recovery, multiple
browsers/concurrent admission, member/owner/admin permissions, chat/DM/announcements/Pulse,
uploads/media/agents, forged/cross-community/expired/revoked sessions, signature replay,
OIDC consent/denial/PKCE/redirect/nonce/client isolation and grant revocation, direct Data API
attempts, restart/outage, partition rollover, and desktop/mobile review.

Confirm Pro daily backups with seven-day retention and restore an actual backup into an
isolated target. Test recovering the external master keys as well: a restored database
alone cannot decrypt identities. Do not restore over the old or candidate production data.
Daily backups mean up to about 24 hours of data loss; PITR is not included.
[Supabase backups](https://supabase.com/docs/guides/platform/backups).

Only after all gates pass: announce a maintenance window of at most 30 minutes, stop old
writers/resident agents, deploy prepared services and web builds against Ohio, bootstrap
verified staff, smoke-test real Google and shared login, then reopen. Record deployment SHAs,
configuration version and smoke evidence. Monitor login/provisioning/signing failures,
revocation, DB pool saturation, relay reconnects, email delivery and OAuth errors.

Before reopening, rollback restores the untouched old deployment. After reopening, freeze
writes and preserve new Supabase accounts/content before any rollback. Never silently discard
new writes. Retiring the old database or any unused project is a separate confirmed cleanup.
