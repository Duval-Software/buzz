#!/usr/bin/env bash
# Run on buzz-relay-01 as root from the /opt/buzz checkout after `git pull`.
# Idempotent: host pieces the Duval chat owns for itself and for the shared edge.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Shared edge network and site directory (imported by deploy/compose/Caddyfile).
docker network inspect buzz-edge >/dev/null 2>&1 || docker network create --label com.buzz.network=edge buzz-edge
install -d -m 0755 /etc/buzz-edge/sites
install -m 0644 "$REPO/deploy/edge/00-edge.caddy" /etc/buzz-edge/sites/00-edge.caddy

# Landing page (the logo /opt/buzz-landing/duval.png is host-only and kept as is).
install -d -m 0755 /opt/buzz-landing
install -m 0644 "$REPO/deploy/landing/index.html" /opt/buzz-landing/index.html

# Nightly backups.
install -d -m 0755 /opt/buzz-ops
install -m 0755 "$REPO/deploy/ops/backup-postgres.sh" /opt/buzz-ops/backup-postgres.sh
install -m 0644 "$REPO/deploy/ops/buzz-backup.service" /etc/systemd/system/buzz-backup.service
install -m 0644 "$REPO/deploy/ops/buzz-backup.timer" /etc/systemd/system/buzz-backup.timer
systemctl daemon-reload
systemctl enable --now buzz-backup.timer
systemctl list-timers buzz-backup.timer --no-pager | head -3
echo "ops installed."
