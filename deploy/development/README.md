# CreatorHive releases

## Daily development

`./scripts/setup-web.sh` once, then `pnpm dev:web`. Run `pnpm check:web` and
`pnpm test:web` before pushing. `pnpm doctor` checks the live environment.

`creatorhive-web` is the GitHub default and integration branch. Cloudflare Pages
deploys frontend inputs from this branch. Its watched paths are `web/*`,
`deploy/cloudflare/*`, root package/lock/workspace files and `patches/*`.

The integration branch requires the `CreatorHive Checks` result and resolved PR
conversations, and blocks ordinary force pushes/deletion. Repository admins retain
GitHub's bypass for maintenance; normal feature work goes through a PR.

The CreatorHive workflow builds, checks and packages backend changes on Linux.
After checks pass, its `development` environment streams the immutable artifact
to the existing dev server. Deployments are serialized by GitHub and a server
lock. A failed readiness check automatically restores the prior release.

## What a release contains

- Relay binary from the exact CreatorHive commit, built with the pinned Rust toolchain.
- Keeper commit and binary checksum pinned in `keeper.json`. The receiver requires
  that exact artifact in `/opt/creatorhive-preview/keepers/<sha256>`.
- SHA-384 checksums for every SQLx migration; deployment rejects schema drift.
- The SHA-256 of the reviewed development Compose configuration.
- Build time, previous release, binary checksums and an immutable release directory.

Each release retains its Compose configuration and runtime image pin, so rollback
restores the matching configuration too. The runtime base is pinned by image ID
in the protected `runtime.env`. Release
artifacts remain in GitHub Actions for 90 days and on the server until an operator
archives them. The baseline preserves the original binaries; its source revisions
are explicitly marked unrecorded. A release does not run database migrations.

`https://api-dev.creatorhive.ai/assets/release.json` reports the running backend.
The frontend exposes it at `/backend-build-info.json` with caching disabled.

## Operator setup and rollback

Server directory: `/opt/creatorhive-preview`. Install `release.py` and
`compose.yml` from this directory as `release.py` and `development.compose.yml`.
The base `deploy/compose/compose.yml` remains `compose.yml` on the server.
Keep `.env`, `agentkeeper.env`, `relay-database.env`, certificates, keeper data
and `cloudflared.token` outside release artifacts. Preserve the identity encryption
and keeper master keys in encrypted backups alongside their database backups.

The CI SSH key has a forced command and SSH forwarding/PTY disabled:

```text
restrict,command="python3 /opt/creatorhive-preview/release.py" ssh-ed25519 ...
```

Its private key is the `development` environment secret
`CREATORHIVE_DEV_DEPLOY_KEY`. Host and verified host key are environment variables
`CREATORHIVE_DEV_HOST` and `CREATORHIVE_DEV_KNOWN_HOSTS`. Only `creatorhive-web`
may deploy through this environment. This key cannot open an interactive shell.

Using an already authorized operator SSH connection:

```sh
python3 /opt/creatorhive-preview/release.py status
python3 /opt/creatorhive-preview/release.py rollback <release-id>
```

Rollback checks database compatibility before changing the application. It does
not revert database data. For a keeper update, publish and test its source commit,
build with `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o agentkeeper ./cmd/agentkeeper`,
install that artifact under its checksum, and update `keeper.json` in a reviewed
CreatorHive commit. CI then deploys the selected pair together.

## Database setup

`python3 deploy/supabase/provision.py` reads a protected operator connection from
`PGDATABASE` or `PGSERVICE` and reports applied/pending migrations. `--apply`
applies only missing steps under a database lock, using Supabase's existing ledger.
`--export --project <ref>` prints ordered Supabase MCP arguments for a fresh project.
Passwords, OAuth settings, SMTP, community seeding and staff appointments remain
explicit protected operator inputs; they are never inferred from another environment.

Run `verify_database.sql` as `buzz_relay` and `verify_keeper_role.sql` as
`buzz_agentkeeper` after provisioning. Both require TLS and verify restricted access.
`setup.json` pins the ordered integration SQL. Add migrations instead of modifying
published SQL or checksums. Regenerate the SQLx verifier with
`node deploy/supabase/migration-manifest.mjs` after adding a SQLx migration.

## Production promotion and review previews

Production still uses the older app, relay and database. Promoting the frontend
alone would strand existing accounts/data. Before a production cutover:

Production migrations 29–31 have different meanings/checksums from this branch
(community deletion, deletion recovery and workflow error codes). Do not run this
branch's SQLx migration set over that database. The provisioning command refuses
the legacy public schema; a reviewed data/identity migration is required.

1. Inventory the media host's running services and signing/encryption keys with
   verified operator access; record its current frontend and backend artifacts.
2. Take database, media, git-volume and key backups. Restore into an isolated
   environment and verify existing member identities, messages and media.
3. Rehearse the reviewed database/identity migration there, then test real login,
   chat, uploads, profiles and agent ownership using the exact release pair.
4. Record the old and new release IDs, schema compatibility, URLs and rollback
   decision point. Freeze writes for the final data copy; verify counts and identities.
5. Promote the tested artifacts and routing, run diagnostics and real account
   smoke checks, then reopen writes. Keep the prior environment intact until verified.

An operator can copy `deploy/development/backup-production-db.sh` to the relay
host and run it with Bash to take a private logical backup and test a full restore in a new isolated
container. The September 16 rehearsal restored 1 community, 12 channels, 23 member
rows and 12,485 events. The protected backup is at
`/opt/creatorhive-backups/20260916T013934Z-DoWunj`. This proves a database restore;
media, key recovery and an off-host backup still need their own verification.

Production automation must wait for that rehearsal and verified media-host access.
The development receiver intentionally cannot target production.

## Review a frontend before merging

There is one prepared preview slot: branch `review`, at
`https://review.creatorhive-app-preview.pages.dev/chat`. It uses the shared dev
backend with exact signing/CORS origins. Before using login there, register that
origin's `/chat` and `/chat?account=recovery` callbacks in Supabase Auth, then run
`pnpm doctor --review`. Other branches do not deploy. No wildcard callbacks are needed.

After checking a feature branch, publish its committed frontend with
`git push origin HEAD:review`. If the existing review belongs to a different,
unmerged feature, coordinate who owns this single slot before replacing it.
Check its `/build-info.json` commit before sharing the URL. Backend changes still
deploy only from `creatorhive-web`; this preview does not create a separate database.
