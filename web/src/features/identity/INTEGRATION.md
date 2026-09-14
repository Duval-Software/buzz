# CreatorHive accounts

Members use a username and password to create an account, sign in on another device, and change their password. Existing members create a login in **Your account**; the messaging identity, history, community membership and roles are retained. Administrators resolve registered usernames when granting access. Account creation itself never grants community admission or a role.

## Implemented locally

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

`/onboarding` is a member-gated, optional three-step flow: meet the Hive, choose a display name, then open Chat, Live, or Pulse. New account registration marks the welcome as pending; the ordinary community gate redirects only after the relay accepts membership. Invitation signup preserves its consent/claim flow before entering onboarding. Existing members can reopen it from **Your account → Revisit the community welcome**.

Only **Save & open** publishes a profile update, through the existing signed kind:0 path, and navigation waits for the relay's acceptance. The shared profile helper reads the current profile first, preserves its other fields, validates the name and signer, and refuses to overwrite after an interrupted read. The welcome does not post an introduction, join channels, change roles, or charge a membership. Skip exits without publishing a profile.

The pending/completed marker is local to the browser and keyed by relay URL plus member public key. Unfinished onboarding reappears after login in that browser; individual step drafts stay in memory. Progress is not synced across devices. When browser storage is unavailable, an in-memory fallback keeps Skip usable for the current page session. This is navigation state only, never an access or subscription entitlement.

Verified all three steps at 1440, 768, and 390 pixels, keyboard focus and radio selection, name validation, previous-field preservation, failure/skip behavior, membership denial, interrupted profile reads, and pending-state reload with blocked storage. Tests use synthetic relay traffic; no real profiles or roles were changed. Restart an existing Vite server when adding virtual routes, so its cached route configuration does not overwrite the newly generated route tree.
