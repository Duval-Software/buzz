# CreatorHive staff moderation

The browser entry point is `/manage`, in the existing app shell. It opens to open
reports. Members use `/account-moderation` for their own restrictions, required
rename and appeals. These routes require managed Supabase accounts.
The chat's Report action submits the selected message through existing kind 1984;
it sends only the message ID, author and the member's explanation, never a
surrounding conversation transcript.

## Authority and storage

- Community roles are `owner`, `admin`, `moderator`, `member`. Channel roles are
  unchanged. Owners appoint admins; admins appoint moderators. Staff hierarchy,
  reasons and moderator timeout presets are checked again on every mutation.
- Existing signed commands 9040–9044 perform sanctions/report decisions; 9045
  requires a rename, 9046 reviews an appeal, and 9032 changes a community role.
  Commands are fresh for two minutes. Role changes include the expected old role;
  report decisions include the expected status. A repeated event ID returns its
  original result without duplicating enforcement or audit entries.
- The managed signer dry-runs the same PostgreSQL function used for execution.
  A per-community transaction lock serializes role changes and decisions; a
  rollback prevents a validation request from applying an action.
- `POST /api/identity/moderation/read` accepts a bounded section/status/search/page.
  `POST /api/identity/moderation/appeal` accepts an action ID and explanation.
  Both derive identity/community from an active first-party Supabase session.
  Owned-app OAuth tokens and expired/revoked sessions use the existing rejection
  path. The deployment-admin API is not exposed to the panel.
- Reports, bans and audit history reuse the existing tables. Migration 0032 adds
  private appeal, rename-hold and policy tables. A held username is not released
  when a restriction is reversed or a member renames. One appeal is allowed per
  action. Reversal never restores removed content or overrides newer restrictions.
- Staff report reads include only the selected reported message, not surrounding
  private conversation history. Own-account notices exclude reporter identities
  and internal audit details. The private `buzz` schema is not a browser Data API.

## Word policy deployment

`blocked-words.json` is the reviewed source of truth. It deliberately permits
ordinary swearing. Rules are literal words/phrases, normalized with NFKC, lowercase
and whitespace folding. Matching uses word boundaries, not fuzzy matching or
user-supplied regular expressions. Zero-width formatting characters are removed.

Generate and validate the complete update before applying it:

```sh
python3 moderation/test-policy.py
python3 moderation/build_policy.py --community COMMUNITY_UUID > /tmp/creatorhive-policy.sql
# Apply the successfully generated file using the authorized deployment connection.
```

Never pipe an unvalidated/partial policy directly into a database session. Invalid
input exits before emitting SQL, retaining the last valid deployed revision. The
panel shows only the loaded revision and rule count; editing requires deployment.

The shared event-store trigger covers public messages, replies, edits, Pulse and
public kind-0 profile text, regardless of HTTP/WebSocket/agent origin. Private
channels/DMs, attachments and historical counter/tombstone updates are excluded.
The Supabase profile guard also checks username/display-name saves and availability
requests. Failed publication leaves the client draft available for editing.
Profiles cannot be saved before community provisioning, so a direct RPC cannot
evade the policy by omitting the account-to-community link. `just check` validates
the actual source file and compiler before running the remaining checks.

## Schema application order

1. Apply SQLx migration 0032 through `deploy/supabase/export_migrations.py`, preserving
   its SHA384 checksum/ledger. Do not apply `schema.sql` separately.
2. After the managed account and member profile integration, apply
   `deploy/supabase/moderation_profiles.sql` once, followed by
   `deploy/supabase/moderation_profile_admission.sql` and
   `deploy/supabase/moderation_event_coverage.sql`. These wrap the existing profile RPC,
   installs rename enforcement, and grants the restricted backend role access.
3. Apply the validated policy for the intended community.
4. Deploy the prepared relay binary with automatic startup migrations disabled,
   then the matching browser application. Refresh staff discovery after appointments.

Once applied, 0032 is immutable. Future changes need a new migration; do not edit
the migration checksum to match altered source.

## Validation

Activate Hermit before repository commands. Use disposable databases for fixtures:

```sh
. ./bin/activate-hermit
python3 moderation/test-policy.py
psql "$TEST_DATABASE_URL" -X -f moderation/test-staff.sql
# Separate fixture containing auth_integration.sql, member_profiles.sql and moderation_profiles.sql:
psql "$PROFILE_TEST_DATABASE_URL" -X -f moderation/test-profiles.sql
TEST_DATABASE_URL="$TEST_DATABASE_URL" python3 moderation/test-concurrency.py
cargo test -p buzz-relay moderation --lib
TEST_DATABASE_URL="$TEST_DATABASE_URL" cargo test -p buzz-relay moderation_policy_returns_client_rejection --lib -- --ignored
cargo test -p buzz-db migration::tests --lib
pnpm --dir web check
pnpm --dir web build
pnpm --dir web exec playwright test --config playwright.managed.config.ts
VITE_MANAGED_ACCOUNTS=false pnpm --dir web test:e2e:smoke
just ci
```

SQL fixtures roll back; the concurrency check removes its isolated fixture. The
event-coverage integration must be installed in the fixture too (use `public`
instead of `buzz` in that script for the native public-schema fixture). For an
actual Supabase fixture, run staff SQL with `buzz,extensions` as the transaction
search path; MCP execution omits the psql `\\set` directive. The
profile test requires a disposable Supabase-compatible auth schema and roles, never run it
unadapted against production. The staff SQL matrix covers every pair among owner,
two admins, two moderators and a member, revoked authority, cross-community access,
duplicate commands, stale review, appeal independence, content filtering and DM
exclusion. Browser tests cover navigation, confirmations, denied/stale roles,
responsive review and appeals without messaging admission.

## September 15 preview rehearsal

- Applied to the existing Ohio project `olgskffmtievlhibuhpk`: Supabase migration
  names `buzz_0032_staff_moderation`, `creatorhive_staff_profiles_and_permissions`,
  `creatorhive_abuse_word_policy_v1`, `creatorhive_moderation_profile_admission`,
  `creatorhive_moderation_message_formats`.
- Preview community: `6ea40f06-96a3-4b49-aff1-c9495a8d0cc0`. Six-rule policy revision:
  `3bce891e76769d1b22030bf6c86bd84b7bcee1205b04b50c2960706b88a77808`.
- Native PostgreSQL role/profile/concurrency tests passed. Transactional staff and
  authenticated profile RPC checks also passed against Supabase. The real
  `buzz_relay` TLS connection can read its private directory and policy under RLS.
- Preview relay binary SHA256:
  `1420b7f9ea6a72697af131b3bcb04435a3ef59579c30ebfde0da3f7d09a5574d`.
  Recreated only `creatorhive-preview-relay-1`; `/info` returns 200 and unauthenticated
  moderation reads return 401. Previous binary remains at
  `/opt/creatorhive-preview/relay-before-staff` for preview rollback.
- Sean's verified account `cd370d19-ac8a-4c23-ba7e-ec6807832432` was appointed admin
  in this preview, with an operator-bootstrap audit record. Lucas's appointment
  still requires his verified account ID. No first-signup or email-based promotion.
- Real Chrome rehearsal loaded the reports, members, appeals and history sections.
  Sean removed a disposable reported message using the real managed signer and
  WebSocket command. Supabase independently confirmed deletion, report resolution,
  audit linkage and the correct actor. Test channels/messages/report were removed;
  the clearly labelled rehearsal action remains in audit history.
- Web smoke suite: 75 passed. Managed suite: 13 passed, one optional SSO-demo test
  skipped before the additional message-report check. Six focused moderation browser
  checks passed, covering desktop/390px, timeout presets and keyboard report-dialog operation. Rust
  moderation tests: 25 passed; the separate PostgreSQL error-mapping test passed.
  Eight simultaneous commands produced one restriction and one audit entry.
- `just ci` passed, including Rust formatting/Clippy, web/desktop checks and builds,
  desktop tests, and the 1,261-test mobile suite. The separately requested `just test`
  passed its unit stages and stopped when its Docker service prerequisite timed out.
- Production containers/domain and Git remote were not changed. The relay build
  excludes concurrent, unreleased public-profile work in this shared checkout.

Release gates: complete the remaining full-suite checks before production. The
standard `just test` integration stage requires local Docker services, which are
not running; the moderation PostgreSQL checks ran separately without Docker.
The global Pulse removal is persisted immediately,
but an already-open feed may need refreshing (channel removals send the existing
deletion notice). Delivery of member notices is best effort; the committed action
and own-account restriction screen remain authoritative. No AI, billing, hardware,
ownership-transfer UI, general DM browser or username trading is included.
