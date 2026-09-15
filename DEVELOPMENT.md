# Developing CreatorHive

CreatorHive's browser app is in `web/`, on the `creatorhive-web` branch of
`Duval-Software/buzz`. It uses React, TypeScript, Vite and TanStack Router,
with the Buzz Rust relay for chat and community data. Managed accounts use
Supabase Auth and the relay's account APIs.

This guide covers the CreatorHive browser app. The root README and
[CONTRIBUTING.md](CONTRIBUTING.md) also cover upstream Buzz's desktop, mobile
and self-hosted services. `just dev` starts the desktop workflow.

## 1. Get the code and tools

For a new checkout:

```sh
git clone --branch creatorhive-web https://github.com/Duval-Software/buzz.git creatorhive
cd creatorhive
. ./bin/activate-hermit
pnpm install --frozen-lockfile
just hooks
```

Hermit downloads the repository's pinned tools on demand. Activate it in
each new terminal, including before Git commands and hooks. The current
pins include Node 24.15.0 and pnpm 11.4.0; use the repo's versions rather
than upgrading dependencies during setup.

For the existing checkout on Sean's Mac:

```sh
cd /Users/sean/orca/projects/creatorhive
. ./bin/activate-hermit
git status --short
git branch --show-current
```

Preserve existing uncommitted work. A fresh clone contains only published
commits, so get the intended development commit from the maintainer if a
feature described here has not been pushed yet.

## 2. Configure the managed preview

Use this path for the current Google/email sign-in, onboarding, chat and
community UI. You need access to an **isolated preview relay**, its matching
Supabase project, and a test account. Docker is not needed on your laptop
when those services are already running remotely.

Ask the maintainer for:

- The preview SSH destination and authorized SSH access, or a directly
  reachable preview relay URL.
- The matching Supabase project URL and **publishable** key.
- A test account or permission to register one; Google test-user access if
  the provider is still in testing mode.
- Preview keeper/stage endpoints only if your work needs hosted agents or video.

Create the development configuration once, without overwriting an existing file:

```sh
test -f web/.env.development.local || cp web/.env.example web/.env.development.local
```

Edit `web/.env.development.local` and replace the two Supabase placeholders.
All `VITE_*` values are visible to browsers: use only the publishable key,
never a service-role key, database password, SSH key or signing secret.

The template expects a relay at `ws://localhost:3300`. For the existing
preview topology, keep this tunnel running in a separate terminal:

```sh
PREVIEW_SSH_TARGET='your-user@your-preview-host'
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L 127.0.0.1:3300:127.0.0.1:3300 "$PREVIEW_SSH_TARGET"
```

Replace the SSH destination with the one provided by the maintainer; use
your configured SSH identity and verified host key. Port 3300 must match
the preview relay's remote loopback port. If you have a direct preview
`wss://` URL instead, put it in `VITE_RELAY_URL` and skip the tunnel.

The preview operator must configure the relay's host/community mapping,
HTTP origins and CORS for the chosen relay URL and `http://localhost:5173`.
Supabase must allow the exact callbacks
`http://localhost:5173/chat` and
`http://localhost:5173/chat?account=recovery`. A working sign-in page alone
does not establish that the relay accepts the account.

### Environment files and optional services

| File / variable | Purpose |
| --- | --- |
| Root `.env` | Rust relay and Docker configuration, loaded by `just`. Not the frontend setup file. |
| `web/.env.development.local` | Ignored local configuration for the Vite development server. |
| `web/.env.production` | Tracked hosted-service defaults used by production-mode builds. |
| `VITE_RELAY_URL` | WebSocket relay address; Vite derives the relay HTTP proxy target from it. |
| `VITE_MANAGED_ACCOUNTS` | `true` enables Supabase sign-in and managed relay accounts. |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Public configuration for the same preview's Supabase project. |
| `VITE_KEEPER_URL` | Optional HTTP origin for hosted agents. In managed mode, blank uses the relay as the proxy target; it does not provide a keeper service. |
| `VITE_STAGE_URL` | Optional stagekeeper origin. Blank disables video and the legacy join bridge. |
| `VITE_PUBLIC_PROFILES` | Enable only after the matching preview relay and profile schema are ready. |

For the optional preview keeper, the recorded remote port is 8092. Forward
it using another `-L 127.0.0.1:8092:127.0.0.1:8092` on the appropriate SSH
connection and set `VITE_KEEPER_URL=http://localhost:8092`. Confirm the
current service location with the maintainer. Stagekeeper, agentkeeper and
LiveKit have separate service setup; starting Vite does not start them.

Restart Vite after changing environment files. Use `--mode development`
for local work. `--mode production` loads hosted defaults, and a local
frontend can still write to whichever backend its environment selects.
Shell environment variables take precedence; `web/.env.local` also applies
across modes, so check for stale overrides when switching setups.

## 3. Start developing

From the repository root, with the preview tunnel running:

```sh
. ./bin/activate-hermit
pnpm --filter buzz-web dev --mode development --host localhost --port 5173
```

Open **http://localhost:5173/chat**. Use `localhost` consistently: callback,
origin and signed-request settings can distinguish it from `127.0.0.1`.
Sign in, complete onboarding if needed, and confirm that channels load.
Save a frontend file to see Vite's live update. Stop Vite and the tunnel
with Ctrl+C in their respective terminals.

Useful connection checks:

```sh
curl --fail --silent --show-error http://localhost:3300/health
curl --fail --silent --show-error http://localhost:5173/relay-info
```

For a direct remote relay, use its HTTPS health URL instead of port 3300.
Then verify actual behavior in the browser: reload the channel, send a test
message in the preview, and reload again to confirm persistence. Use a
preview account/channel where test writes are expected.

`just web` is a different workflow: it derives a port and relay address
from the worktree. Use the explicit command above when working with the
managed preview's fixed port and OAuth callbacks.

## 4. Find the code

| Change | Start here |
| --- | --- |
| Navigation, sidebar, shared page header | `web/src/features/surfaces/ui/CommunityShell.tsx` and `community-shell.css` |
| Shared appearance | `web/src/shared/styles/community.css`, `globals.css`, `web/src/shared/theme/` |
| Messages, composer, threads, presence | `web/src/features/chat/` |
| Inbox, Pulse, Live, agents | The matching directory in `web/src/features/` |
| Sign-in and account bootstrap | `web/src/features/identity/`, `web/src/shared/lib/supabase.ts` |
| Onboarding and public profiles | `web/src/features/onboarding/`, `web/src/features/profile/` |
| Routes | `web/src/app/routes.ts` and `web/src/app/routes/` |
| Relay transport and request signing | `web/src/shared/lib/nostr-socket.ts`, `nostr-signer.ts`, `nip98.ts` |
| Backend APIs and event handling | `crates/buzz-relay/src/api/` and `handlers/` |
| Database and schema changes | `crates/buzz-db/`, `migrations/`, `deploy/supabase/` |
| Browser tests and synthetic community data | `web/tests/e2e/`, `web/tests/managed/`, `web/tests/helpers/community.ts` |

The route tree, `web/src/app/routeTree.gen.ts`, is generated by Vite;
edit the route definitions rather than the generated file. Reuse shared
components and theme variables. Keep readable text zoom-safe with rem-based
tokens. Channel events use `h` tags; permissions must be enforced by the
relay, not just hidden in the UI. See [AGENTS.md](AGENTS.md) for repository
conventions and required checks.

## 5. Check your changes

From the repository root:

```sh
pnpm --filter buzz-web check
pnpm --filter buzz-web typecheck
pnpm --filter buzz-web build
git diff --check
```

`build` produces `web/dist`; it does not publish anything. It uses production
mode by default, so it does not load `web/.env.development.local`. For a
locally configured artifact, use
`pnpm --filter buzz-web build --mode development`.

Install the browser used by tests once:

```sh
pnpm --filter buzz-web exec playwright install chromium
```

Use the existing fixtures for repeatable tests without real community writes:

```sh
# Standard web suite: builds first, then serves the result on port 4173.
VITE_MANAGED_ACCOUNTS=false VITE_PUBLIC_PROFILES=false pnpm --filter buzz-web test:e2e:smoke

# Managed sign-in/account tests: separate fixture build and port 4174.
pnpm --dir web exec playwright test --config playwright.managed.config.ts

# Public-profile tests, including the enabled onboarding path, on port 4186.
PROFILE_ONBOARDING_TEST=1 pnpm --dir web exec playwright test --config playwright.profiles.config.ts
```

The managed configs supply synthetic Supabase settings. Fixture results prove
application behavior against test responses; verify real authentication and
backend persistence separately. Visually check UI changes on desktop and at
390 × 844, including light/dark appearance and keyboard focus.

Before a PR, run `just ci`; it includes Rust, desktop, web and mobile checks
and needs the broader toolchain. Changes to `buzz-relay`, `buzz-db` or
`buzz-auth` also require `just test` with local Postgres and Redis. Commit
with `git commit -s` for the required sign-off.

## Optional: run the Rust backend locally

For relay/database work, start Docker and use the existing development setup:

```sh
. ./bin/activate-hermit
test -f .env || cp .env.example .env
```

Review root `.env` first: its database and Redis URLs must target your local
development services. Then run:

```sh
just setup
just relay
```

`just setup` starts the Docker development services, migrates the configured
database, seeds host mappings, installs JS dependencies and hooks. `just relay`
starts the Rust server on port 3000 with the default configuration.
`docker compose down` stops the containers while retaining volumes.

This is the Buzz backend development stack. It does **not** provision
Supabase Auth, managed-account SQL/grants, Google login, keepers or LiveKit.
Use [the Supabase integration runbook](deploy/supabase/README.md) when
provisioning a new managed preview. For legacy relay testing, set
`VITE_MANAGED_ACCOUNTS=false` and `VITE_RELAY_URL=ws://localhost:3000` in
your development env; membership and account admission still need the
corresponding local setup. Do not turn off auth to bypass a setup failure.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Port 5173 is already in use | Inspect `lsof -nP -iTCP:5173 -sTCP:LISTEN`; reuse the right server or stop it in its own terminal. A different port needs matching callback/origin configuration. |
| Login works, but chat never connects | Check the tunnel, relay health, `VITE_RELAY_URL`, managed account bootstrap and allowed origins. An HTTP 200 from Vite only proves the frontend is running. |
| Google sign-in is refused or redirects elsewhere | Check test-user access, the Supabase project and exact localhost callback URLs. |
| Wrong backend or old UI | Check the Vite mode and env overrides, restart the correct server, and reload. If assets remain stale, inspect the app's service worker/cache in DevTools. |
| Unknown-host / community 404 | Check the relay's host-to-community mapping; changing `localhost` to an IP can select a different host boundary. |
| Agents/video unavailable | Confirm the separate keeper/stage service and its preview origins; frontend startup cannot supply it. |
| Public profiles are unavailable | Follow the profile integration runbook and verify both frontend and backend feature flags. |
| Browser tests show a previous build | Port 4173 can reuse an existing preview server. Stop that test server, rebuild, and rerun; managed test ports must also be free. |
| Hooks cannot find tools | Activate `. ./bin/activate-hermit` in the terminal running Git. |

## Further reading

- [Account integration](web/src/features/identity/INTEGRATION.md)
- [Public profiles](web/src/features/profile/INTEGRATION.md)
- [Community permissions](web/src/features/community/INTEGRATION.md)
- [Live studio](web/src/features/live/INTEGRATION.md)
- [Hosted agents](web/src/features/agents/INTEGRATION.md)
- [Supabase and preview backend](deploy/supabase/README.md)
- [Cloudflare hosting](deploy/cloudflare/README.md)

Deployment is a separate step. Read the hosting configuration before pushing:
the Cloudflare runbook records a Git-connected preview for `creatorhive-web`,
so a push can trigger a remote build. Local development does not require a
commit, push, database migration on a shared service, or production release.
