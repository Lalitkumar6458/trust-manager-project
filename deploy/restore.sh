#!/usr/bin/env bash
# Restore a backup made by deploy/backup.sh  (REPLACES the current data!)
#   sudo -u trust bash deploy/restore.sh /var/backups/trust-manager/db_2026-11-17_0230.dump [files_2026-11-17_0230.tar.gz]
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
set -a; source "$APP_DIR/.env.local"; set +a
DB_FILE="${1:?give the db_….dump file}"
read -r -p "This REPLACES all current data with $DB_FILE. Type YES to continue: " ok
[[ "$ok" == "YES" ]] || exit 1
pm2 stop trust-manager || true
pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" "$DB_FILE"
if [[ -n "${2:-}" ]]; then tar -xzf "$2" -C "$(dirname "${UPLOAD_DIR:-$APP_DIR/uploads}")"; fi
pm2 start trust-manager
echo "✔ restored"
