#!/usr/bin/env bash
# Copy the project from your Mac to the VPS without GitHub, then build there.
#   bash deploy/push-from-mac.sh root@<VPS-IP>
set -euo pipefail
TARGET="${1:?usage: bash deploy/push-from-mac.sh root@<VPS-IP>}"
cd "$(dirname "$0")/.."
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude .git --exclude uploads \
  --exclude '.env*' --exclude '*.log' --exclude 'service-account*.json' --exclude 'migration-temp-passwords.csv' \
  ./ "$TARGET:/var/www/trust-manager/"
ssh "$TARGET" 'chown -R trust:trust /var/www/trust-manager && sudo -u trust bash /var/www/trust-manager/deploy/deploy.sh'
