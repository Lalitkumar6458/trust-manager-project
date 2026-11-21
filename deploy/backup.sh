#!/usr/bin/env bash
# Nightly backup: database (pg_dump) + uploaded files.
#  • multi-sanstha mode (CONTROL_DATABASE_URL): control DB + one dump per sanstha database
#  • keeps KEEP_DAYS (30) days on the server in BACKUP_DIR
#  • OFF-SITE copy (recommended): if BACKUP_REMOTE is set in .env.local, every backup is
#    encrypted with BACKUP_PASSPHRASE (gpg AES-256) and uploaded with rclone
#    (Google Drive, Backblaze B2, S3, Dropbox … – see "Off-site backup" in README).
#    Remote copies older than REMOTE_KEEP_DAYS (90) are deleted.
# Run by cron (see /etc/cron.d/trust-manager). Manual: sudo -u trust bash deploy/backup.sh
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
set -a; source "$APP_DIR/.env.local"; set +a
BACKUP_DIR=${BACKUP_DIR:-/var/backups/trust-manager}
KEEP_DAYS=${KEEP_DAYS:-30}
REMOTE_KEEP_DAYS=${REMOTE_KEEP_DAYS:-90}
UPLOADS="${UPLOAD_DIR:-$APP_DIR/uploads}"
STAMP=$(date +%F_%H%M)
mkdir -p "$BACKUP_DIR"
umask 077   # backups contain donor data – only the app user may read them

fail() { echo "$(date '+%F %T') BACKUP FAILED: $*" >&2; exit 1; }

FILES=()
if [[ -n "${CONTROL_DATABASE_URL:-}" ]]; then
  # multi-sanstha: control database + every sanstha database (one file each)
  DB_FILE="$BACKUP_DIR/control_$STAMP.dump"
  pg_dump --no-owner --format=custom "$CONTROL_DATABASE_URL" > "$DB_FILE" || fail "pg_dump control"
  FILES+=("$DB_FILE")
  BASE_URL="${TENANT_DATABASE_URL:-$CONTROL_DATABASE_URL}"
  while IFS='|' read -r SLUG DBN; do
    [[ -z "$SLUG" ]] && continue
    F="$BACKUP_DIR/db_${SLUG}_$STAMP.dump"
    pg_dump --no-owner --format=custom "${BASE_URL%/*}/$DBN" > "$F" || fail "pg_dump $SLUG"
    FILES+=("$F")
  done < <(psql "$CONTROL_DATABASE_URL" -tAF '|' -c "SELECT slug, db_name FROM tenants WHERE deleted_at IS NULL ORDER BY slug")
else
  DB_FILE="$BACKUP_DIR/db_$STAMP.dump"
  pg_dump --no-owner --format=custom "$DATABASE_URL" > "$DB_FILE" || fail "pg_dump"
  FILES+=("$DB_FILE")
fi
if [[ -d "$UPLOADS" ]]; then
  tar -czf "$BACKUP_DIR/files_$STAMP.tar.gz" -C "$(dirname "$UPLOADS")" "$(basename "$UPLOADS")" || fail "tar uploads"
  FILES+=("$BACKUP_DIR/files_$STAMP.tar.gz")
fi
find "$BACKUP_DIR" -maxdepth 1 -type f -mtime +"$KEEP_DAYS" -delete
echo "$(date '+%F %T') backup ok: ${#FILES[@]} file(s), $(du -ch "${FILES[@]}" | tail -1 | cut -f1)"

# ---------------- off-site copy ----------------
if [[ -n "${BACKUP_REMOTE:-}" ]]; then
  command -v rclone >/dev/null || fail "rclone not installed (sudo apt install -y rclone)"
  [[ -n "${BACKUP_PASSPHRASE:-}" ]] || fail "BACKUP_PASSPHRASE is empty – set it in .env.local (backups are encrypted before upload)"
  TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
  for f in "${FILES[@]}"; do
    gpg --batch --yes --pinentry-mode loopback --passphrase-fd 3 --symmetric --cipher-algo AES256 \
        -o "$TMP/$(basename "$f").gpg" "$f" 3<<<"$BACKUP_PASSPHRASE" || fail "gpg encrypt $(basename "$f")"
  done
  rclone copy "$TMP" "$BACKUP_REMOTE" --transfers 2 --retries 5 --low-level-retries 10 || fail "rclone upload to $BACKUP_REMOTE"
  rclone delete "$BACKUP_REMOTE" --min-age "${REMOTE_KEEP_DAYS}d" --include "*.gpg" || echo "warning: old remote backups not cleaned"
  echo "$(date '+%F %T') off-site ok: $BACKUP_REMOTE ($(ls "$TMP" | tr '\n' ' '))"
fi
