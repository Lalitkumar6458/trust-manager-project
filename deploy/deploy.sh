#!/usr/bin/env bash
# Update the app on the VPS to the latest code:
#   sudo -u trust bash /var/www/trust-manager/deploy/deploy.sh
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
echo "==> backup before update"
bash deploy/backup.sh || echo "(backup failed – continuing)"
if [[ -d .git ]]; then
  echo "==> git pull"
  git pull --ff-only
fi
echo "==> install"
npm ci --no-audit --no-fund
echo "==> database migrations"
npm run db:migrate
echo "==> build"
npm run build
echo "==> restart"
pm2 reload trust-manager || pm2 start ecosystem.config.cjs
pm2 save
sleep 3
curl -fsS http://127.0.0.1:3000/api/health && echo && echo "✔ updated"
