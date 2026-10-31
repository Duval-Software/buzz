# Duval Software chat: deployment notes

`https://chat.duvalsoftware.com` is Duval Software's internal team workspace: one Buzz community on a
relay we run. This branch (`duval-deploy`) is the deployment overlay on top of upstream `block/buzz`:
only `deploy/` matters here. The relay itself is the upstream image, pinned by digest in the server's `.env`.

## Where it runs

- Host: Hetzner `buzz-relay-01` (CPX31, Ashburn, `5.161.207.16`), hcloud context `duval`, daily Hetzner backups on.
- Checkout: `/opt/buzz` on this branch. Compose project `buzz-prod`, files
  `deploy/compose/compose.yml` + `deploy/compose/compose.caddy.yml`, env `deploy/compose/.env` (root only, never in Git).
- DNS: Cloudflare zone `duvalsoftware.com`, `chat` and `buzz` A records to the host, DNS only (Caddy does Let's Encrypt).
- Relay image: `ghcr.io/block/buzz@sha256:4e31b7c7abb7d00b6f513dc559e58d2b980416f1dc400aa01bcf762cf2989cfc`
  = Buzz Relay 0.2.1 (block/buzz `6e5c462a`, 2026-08-08, schema 28). Before 2026-10-31 it was the floating
  `ghcr.io/block/buzz:main` as pulled on 2026-08-01 (schema 26). Never go back to a floating tag:
  `docker compose pull` would jump to whatever upstream main is (schema 79 and counting) and auto-migrate.
- Communities in the database: `chat.duvalsoftware.com` (the real one), plus three one-member bootstrap
  leftovers from the first day (`5.161.207.16:3000`, `buzz.5-161-207-16.sslip.io`, `buzz.duvalsoftware.com`).

## The shared edge

This stack's Caddy owns ports 80/443 for the whole host. Other Buzz communities on the host run as their own
Compose projects with their own databases and publish nothing; they join the external Docker network
`buzz-edge` and drop one site file into `/etc/buzz-edge/sites/` (mounted at `/etc/caddy/sites`), which the
Caddyfile imports. Today: `placemaking.chat` from `Duval-Software/placemaking-buzz`. The relay serves its own
web client (`BUZZ_WEB_DIR` in the 0.2.1 image), so the old `web/dist` mount and SPA fallback are gone.

## Other services on the host (not in Compose)

`livekit-duval` + `stagekeeper-duval` + `office-caddy :8443` (the Duval office stage), `whisper-stt :9077`
(voice-note conversion behind `/voice/convert`), `duval-join` (auto-join bot) and the `duval-channel-policy`
cron. All enabled systemd units; they talk to the relay at `https://chat.duvalsoftware.com`.

## Operate

```sh
cd /opt/buzz && git pull --ff-only
deploy/ops/install-ops.sh                 # edge network + sites dir, landing, nightly backup timer
cd deploy/compose
BUZZ_COMPOSE_TLS=true ./run.sh config     # renders?
docker compose --env-file .env -f compose.yml -f compose.caddy.yml up -d --wait
docker exec buzz-prod-caddy-1 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

Checks: `curl -fsS -H 'Accept: application/nostr+json' https://chat.duvalsoftware.com/ | head -c 200`,
`https://chat.duvalsoftware.com/` is the join page, `/chat` the web client.

## Upgrade the relay

1. Pick a tagged `relay-v*` release and its digest; read the migrations between the running schema and it.
2. `systemctl start buzz-backup.service` and confirm a fresh dump in `/var/backups/buzz/`; for a large jump also
   `hcloud server create-image --type snapshot buzz-relay-01`.
3. In `.env`: new `BUZZ_IMAGE` digest, `BUZZ_AUTO_MIGRATE=true`. `docker compose ... pull && up -d --wait`.
4. Verify NIP-11, the web client, a login from the app, `duval-join` logs. Then `BUZZ_AUTO_MIGRATE=false` and
   recreate the relay.

Roll back: previous digest in `.env` and `up -d` if no migration ran; otherwise stop the relay, `pg_restore`
the matching dump into `buzz-prod-postgres-1`, then the previous digest. Whole host: the Hetzner snapshot.

## Backups

`buzz-backup.timer` runs `/opt/buzz-ops/backup-postgres.sh` nightly at 03:30 UTC: a `pg_dump -Fc` of every
Buzz Postgres on the host plus a copy of each stack's `.env`, under `/var/backups/buzz/`, 14 days kept.
Hetzner's daily server backup covers MinIO media and the Git volume.

## 2026-10-31 maintenance (what changed)

Snapshot `450566457` taken first. OS packages updated and the host rebooted onto the current kernel (it had
run 6.8.0-117 since 2026-08-01 with eight newer kernels pending). Relay pinned and moved from the Aug 1
`main` build to Relay 0.2.1 (migrations 0027 channels id lookup index, 0028 long reaction payloads).
Caddy now imports shared-edge site files and lets the relay serve the web client. Landing page download
links moved from desktop 0.5.3 to 0.5.28. Nightly backups added. `placemaking.chat` deployed beside it.
