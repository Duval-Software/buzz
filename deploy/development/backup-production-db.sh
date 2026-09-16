#!/usr/bin/env bash
# Run on creatorhive-01 as an operator. Reads production; restores only in a new,
# network-isolated disposable container. Backups stay private on this server.
set -euo pipefail
umask 077
mkdir -p /opt/creatorhive-backups
backup_dir=$(mktemp -d "/opt/creatorhive-backups/$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
docker exec buzz-prod-postgres-1 sh -ec 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup_dir/database.dump.partial"
mv "$backup_dir/database.dump.partial" "$backup_dir/database.dump"
sha256sum "$backup_dir/database.dump" > "$backup_dir/database.sha256"

restore_container="creatorhive-restore-$(basename "$backup_dir")"
docker run --rm -d --name "$restore_container" --network none --memory 512m --cpus 0.5 \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine > /dev/null
trap 'docker rm -f "$restore_container" > /dev/null 2>&1 || true' EXIT
for attempt in {1..30}; do
  if docker exec "$restore_container" pg_isready -U postgres > /dev/null 2>&1; then break; fi
  sleep 1
done
if ! docker exec -i "$restore_container" pg_restore -U postgres -d postgres --no-owner --no-privileges --exit-on-error \
  < "$backup_dir/database.dump" > "$backup_dir/restore.log" 2>&1; then
  echo "Restore failed; inspect the protected log: $backup_dir/restore.log" >&2
  exit 1
fi
docker exec "$restore_container" psql -U postgres -XAt -v ON_ERROR_STOP=1 -c \
  "SELECT json_build_object('communities',(SELECT count(*) FROM communities),'channels',(SELECT count(*) FROM channels),'members',(SELECT count(*) FROM relay_members),'events',(SELECT count(*) FROM events),'migration_version',(SELECT max(version) FROM _sqlx_migrations));" \
  > "$backup_dir/restored-counts.json"
echo "Database backup restored successfully: $backup_dir"
cat "$backup_dir/restored-counts.json"
