#!/usr/bin/env bash
# Nightly backup of Parks Passport on aster (run by root's cron; see docs/backup-restore.md).
#   - app.db: consistent online copy (SQLite backup API), gzipped
#   - uploads/ (photos, badge art) and settings.key (decrypts the SendGrid key saved in the admin)
# Writes to $BACKUP_DIR (outside the code tree) and keeps 14 days.
set -euo pipefail

CONTAINER="${CONTAINER:-parks-passport}"
BACKUP_DIR="${BACKUP_DIR:-/root/backups/parks-passport}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%F)"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Database: backup inside the container, copy out, compress.
docker exec "$CONTAINER" node scripts/db-backup.js /tmp/app-backup.db
docker cp "$CONTAINER:/tmp/app-backup.db" "$BACKUP_DIR/app-$STAMP.db"
docker exec "$CONTAINER" rm -f /tmp/app-backup.db
gzip -f "$BACKUP_DIR/app-$STAMP.db"

# Files: photos, badge art, and the settings key if the app generated one.
FILES="uploads"
if docker exec "$CONTAINER" test -f /data/settings.key; then FILES="$FILES settings.key"; fi
if docker exec "$CONTAINER" test -d /data/uploads; then
  # tar exits 1 if a file changed while it was read (a photo uploaded mid-backup): still a usable
  # archive, so only exit codes above 1 stop the backup.
  # shellcheck disable=SC2086
  docker exec "$CONTAINER" tar czf - --warning=no-file-changed -C /data $FILES > "$BACKUP_DIR/files-$STAMP.tar.gz" || [ $? -eq 1 ]
fi

chmod 600 "$BACKUP_DIR"/*-"$STAMP".* 2>/dev/null || true
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'app-*.db.gz' -o -name 'files-*.tar.gz' \) -mtime +"$((KEEP_DAYS - 1))" -delete  # +13 keeps 14 daily sets

echo "$(date -Is) parks-passport backup ok: $(du -sh "$BACKUP_DIR" | cut -f1) in $BACKUP_DIR"
