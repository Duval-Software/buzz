# Shared CreatorHive development — September 15, 2026

- **Review:** https://dev.creatorhive.ai/chat
- **Code locally:** `pnpm dev:web` from the repository root after installing dependencies.
- **Backend:** https://api-dev.creatorhive.ai (`wss://api-dev.creatorhive.ai` for chat).
- **Git:** `Duval-Software/buzz`, branch `creatorhive-web`.
- **Frontend:** existing Pages project `creatorhive-app-preview`; automatic branch builds use `pnpm --dir web build:preview` and the committed public `web/.env.development` settings.
- **Relay:** existing isolated preview on creatorhive-01 (`87.99.157.94`), host loopback port 3300; keeper remains loopback 8092.
- **Tunnel:** `creatorhive-development`, ID `30ddb751-df6a-46f1-9aff-b2e0bcd07d47`. Remote ingress sends `/keeper` paths to 8092, other API-host traffic to 3300, and unmatched hostnames to 404. The server runs the pinned connector; developers need no SSH key.

`development-worker.mjs` is copied to the preview build as `_worker.js`. It proxies
same-origin uploads and keeper requests to the development backend, preserving
signed authorization and bodies, stripping browser cookies, and disabling API
response caching. Static frontend files remain on Pages. It is not included in
ordinary production builds. Run `node --test deploy/cloudflare/development-worker.test.mjs`.

## Operator configuration

The preview community ID remains `6ea40f06-96a3-4b49-aff1-c9495a8d0cc0`. Its host map
is now `api-dev.creatorhive.ai`; members, messages, profiles and roles are unchanged.
The supported runtime configuration is now `deploy/development/compose.yml`,
merged with the base Compose file. It replaces the three historical preview
overlays. Use the [release procedure](../development/README.md) for changes.
For an operator-only service restart:

```sh
cd /opt/creatorhive-preview
. ./release.env
docker compose --project-directory "$PWD" --env-file .env --env-file "releases/$RELEASE_ID/runtime.env" --env-file release.env -f compose.yml -f "releases/$RELEASE_ID/compose.yml" up -d --no-deps relay agentkeeper cloudflared
```

The remote-managed tunnel token lives only in `/opt/creatorhive-preview/cloudflared.token`,
owned by UID 65532 with mode 0400, mounted read-only. It is not in Git or a frontend
environment file. Supabase has the exact hosted callbacks
`https://dev.creatorhive.ai/chat` and
`https://dev.creatorhive.ai/chat?account=recovery`, in addition to the existing
localhost callbacks. Normal Supabase sign-in and relay membership enforcement apply.
No Cloudflare Access login is inserted in the browser/WebSocket flow.

## Verify and roll back

`pnpm doctor` must report healthy relay and an expected unauthenticated
401 from the managed bootstrap endpoint. Verify authenticated sign-in, channel
loading, uploads and keeper requests after any operator change; HTTP health alone
is insufficient. The hosted build's asset hashes must match its exact Git deployment.

To undo public development routing, remove only the `api-dev` and `dev` DNS records
and Pages custom domain, and stop the `cloudflared` service. To restore SSH-only
preview, first restore the same community row's host to `localhost:3300`, then
recreate relay/keeper with the original overlays and use the old local environment.
Keep the community ID and stored data. The original production domains and
containers are not part of this rollout.

---

## Historical rollout record

# CreatorHive frontend deployment

## Current state — September 14, 2026

Git integration is connected and automatic production deployments are enabled.
The user connected the existing Pages project to GitHub; no separate repo or
second production Pages project is required.

- Account: fd9be900cda1c34edf565705c06364bd (Lucas / Duval Software).
- Pages project: creatorhive-app-preview.
- Repository: Duval-Software/buzz.
- Production branch: creatorhive-web; other branch deployments disabled.
- Root: repository root (shared pnpm workspace).
- Build: corepack enable && pnpm --filter buzz-web... install --frozen-lockfile && pnpm --dir web build
- Output: web/dist.
- Build environment: NODE_VERSION=22.16.0, SKIP_DEPENDENCY_INSTALL=true,
  VITE_MANAGED_ACCOUNTS=false.
- GitHub app installation: 161747119, approved by Lucas.
- Successful production Git build: a0d53856-dda5-40cf-89a9-bae7a03a4e64.
- Built commit: a2e9ab4c78620cc03ffebd8efe97756c918f96cb.
- Exact deployment: https://a0d53856.creatorhive-app-preview.pages.dev/chat
- Production alias: https://creatorhive-app-preview.pages.dev/chat

The initial build was triggered through the Pages API against the real Git
branch. Future pushes to creatorhive-web are configured to trigger builds;
no test commit was pushed merely to exercise the webhook. Local uncommitted
changes are not included in this deployment. pages-project.json records the
saved configuration. The marketing project creatorhive-site is unchanged.

## Verification and release blocker

Cloudflare reports the Git build and deployment successful. Direct /, /chat,
/live, /pulse and /onboarding returned matching SPA HTML. All seven entry JS/CSS
references loaded successfully. The production alias matches the exact build,
including index-Dt0P9xth.js and index-BRJbqLP_.css. The sign-in page was reviewed
in Chrome. The exact remote commit previously passed web checks, TypeScript and
a local production build in an isolated checkout.

The running relay is NOT compatible with this frontend's account gate:
POST requests with empty JSON bodies to the following URLs all return HTTP 404:

- https://chat.creatorhive.ai/api/accounts/login
- https://chat.creatorhive.ai/api/accounts/register
- https://chat.creatorhive.ai/api/identity/bootstrap

No credentials were sent in these probes. The relay capability document also
lacks creatorhive-accounts-v1. Neither real legacy account login nor managed
Google login is accepted as working. Supabase's Google provider was configured
separately, but its managed identity backend still requires deployment.
Do not route production traffic to the new frontend until authentication works.

## App domain — not switched

app.creatorhive.ai still has its original DNS-only A record to 178.156.187.44.
Zone: c018226eb517887f0211f000dc3f1be2.
Record: 03938f830f8a8f46bedaffad734739ea; TTL automatic.
No Worker route was attached. No backend, database, or existing service changed.

Origin HTTPS was checked directly using app.creatorhive.ai as TLS server name
and Host. /chat returned HTML 200; /keeper/health and /push/health returned JSON
200; unauthenticated /keeper/agents returned 401; GET /upload returned 405.

app-router.mjs is prepared, not deployed. It serves known frontend paths and
assets from the Pages production alias while forwarding other requests to the
existing Hetzner origin with their original URL, headers and streaming body.
It must be a Worker route over the existing proxied A record, not a Worker
custom-domain origin. Tests cover credential isolation, original backend request
preservation, WebSocket upgrades and fallback for old frontend chunks.

Before domain cutover:

1. Deploy and verify the chosen account backend on the relay. For managed Google
   login, coordinate the frontend flag with the Supabase identity backend.
2. Confirm real login, community admission, chat, uploads, agents, push and studio.
3. Configure Full (strict) TLS for this app hostname without changing other hosts.
4. Deploy the router, attach app.creatorhive.ai/*, and proxy the existing A record.
5. Verify the exact frontend assets and compare authenticated backend behavior.

Routing rollback: remove the Worker route and restore this A record to DNS-only.
Keep the old Hetzner frontend files. This frontend change does not migrate data.

Run: node deploy/cloudflare/app-router.test.mjs

## Earlier manual preview

The former direct-upload preview deployment was
88ceb880-48a5-484b-a90c-3d9e19a6b528, branch migration-preview, built from the dirty
local working tree. Its preview-worker.mjs blocks backend paths with 503 and its
headers request no indexing. That preview is distinct from the Git build above.
The project is now Git-connected; build-preview.sh is retained as a historical
local preview helper, not the production deployment process.
