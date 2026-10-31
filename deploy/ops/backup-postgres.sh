#!/usr/bin/env bash
# Nightly logical backups of every Buzz Postgres on this host, plus a copy of each
# stack's .env (the relay private key lives there). Installed at
# /opt/buzz-ops/backup-postgres.sh and run by buzz-backup.timer.
set -euo pipefail
DEST="${DEST:-/var/backups/buzz}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0700 "$DEST" "$DEST/env"

docker ps --filter 'label=com.docker.compose.project' \
  --format '{{.ID}} {{.Image}} {{.Label "com.docker.compose.project"}} {{.Label "com.docker.compose.project.working_dir"}}' |
while read -r id image project workdir; do
  case "$image" in postgres:*) ;; *) continue ;; esac
  user="$(docker exec "$id" printenv POSTGRES_USER)"
  db="$(docker exec "$id" printenv POSTGRES_DB)"
  out="$DEST/${project}-${STAMP}.dump.gz"
  docker exec "$id" pg_dump -U "$user" -d "$db" -Fc | gzip -1 > "$out.tmp"
  mv "$out.tmp" "$out"
  if [[ -n "$workdir" && -f "$workdir/.env" ]]; then
    install -m 0600 "$workdir/.env" "$DEST/env/${project}.env.${STAMP}"
  fi
  printf 'backed up %s -> %s (%s bytes)\n' "$project" "$out" "$(stat -c %s "$out")"
done

find "$DEST" -type f -mtime +"$KEEP_DAYS" -print -delete | sed 's/^/pruned /'
