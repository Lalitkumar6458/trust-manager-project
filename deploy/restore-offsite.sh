#!/usr/bin/env bash
# Download + decrypt an off-site backup (made by deploy/backup.sh with BACKUP_REMOTE).
#   sudo -u trust bash deploy/restore-offsite.sh                 → lists the backups on the remote
#   sudo -u trust bash deploy/restore-offsite.sh 2026-11-17_0230 → downloads + decrypts into ./restore-<stamp>/
# Then restore with:  sudo -u trust bash deploy/restore.sh restore-<stamp>/db_<stamp>.dump [restore-<stamp>/files_<stamp>.tar.gz]
# Works on a NEW server too: install rclone, copy rclone.conf + .env.local (BACKUP_REMOTE, BACKUP_PASSPHRASE).
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
set -a; source "$APP_DIR/.env.local"; set +a
: "${BACKUP_REMOTE:?BACKUP_REMOTE is not set in .env.local}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set in .env.local}"
if [[ -z "${1:-}" ]]; then
  rclone lsl "$BACKUP_REMOTE" --include "db_*.gpg" | sort -k2,3 | tail -40
  echo; echo "Give the stamp (eg. 2026-11-17_0230) as argument to download it."
  exit 0
fi
STAMP="$1"; OUT="restore-$STAMP"; mkdir -p "$OUT"
rclone copy "$BACKUP_REMOTE" "$OUT" --include "*_$STAMP.*.gpg"
for f in "$OUT"/*.gpg; do
  gpg --batch --yes --pinentry-mode loopback --passphrase-fd 3 -o "${f%.gpg}" -d "$f" 3<<<"$BACKUP_PASSPHRASE"
  rm -f "$f"
done
ls -lh "$OUT"
echo "Next: sudo -u trust bash deploy/restore.sh $OUT/db_$STAMP.dump $( [[ -f $OUT/files_$STAMP.tar.gz ]] && echo "$OUT/files_$STAMP.tar.gz")"
