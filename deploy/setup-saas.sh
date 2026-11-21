#!/usr/bin/env bash
# ======================================================================
# Switch a VPS that was set up with deploy/setup-vps.sh to the MULTI-SANSTHA mode
# (one app, many sansthas, each with its own database; owner control panel).
#
#   sudo bash deploy/setup-saas.sh <base-domain> <control-host> <email> [existing-sanstha-shortname]
#   eg: sudo bash deploy/setup-saas.sh trustpanel.in admin.trustpanel.in you@gmail.com shawlaji
#
# Before running – in Hostinger hPanel → Domains → DNS of <base-domain> add:
#     A   *       <VPS-IP>        (every shortname.trustpanel.in)
#     A   @       <VPS-IP>        (optional, the bare domain)
# What it does:
#   • installs Caddy (automatic HTTPS for every sanstha address) and turns Nginx off
#   • creates the control database "tm_control", lets the app create sanstha databases
#   • adds CONTROL_DATABASE_URL / CONTROL_HOST / TENANT_BASE_DOMAIN to .env.local
#   • moves the current uploads into uploads/<existing-shortname> (if given)
#   • runs migrations, rebuilds and restarts the app
# Then: create your owner login (npm run control:owner) and register the existing
# sanstha in the control panel with “Database already exists” = trust.
# Safe to run again.
# ======================================================================
set -euo pipefail
BASE="${1:-}"; CONTROL="${2:-}"; EMAIL="${3:-}"; EXISTING="${4:-}"
APP_USER=trust
APP_DIR=/var/www/trust-manager
if [[ $EUID -ne 0 ]]; then echo "Run as root:  sudo bash $0 …"; exit 1; fi
if [[ -z "$BASE" || -z "$CONTROL" || -z "$EMAIL" ]]; then
  echo "Usage: sudo bash $0 <base-domain> <control-host> <email> [existing-sanstha-shortname]"; exit 1
fi
step() { echo -e "\n\033[1;32m==> $*\033[0m"; }
ENV="$APP_DIR/.env.local"
[[ -f "$ENV" ]] || { echo "$ENV not found – run deploy/setup-vps.sh first"; exit 1; }
DB_URL=$(grep -E '^DATABASE_URL=' "$ENV" | cut -d= -f2-)
[[ -n "$DB_URL" ]] || { echo "DATABASE_URL missing in $ENV"; exit 1; }
CONTROL_URL="${DB_URL%/*}/tm_control"
DB_USER=$(echo "$DB_URL" | sed -E 's#^[a-z]+://([^:]+):.*#\1#')

step "Database: control DB + permission to create sanstha databases"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER ROLE \"$DB_USER\" CREATEDB;" >/dev/null
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='tm_control'" | grep -q 1; then
  sudo -u postgres createdb -O "$DB_USER" tm_control
fi

step ".env.local"
set_env() { if grep -qE "^$1=" "$ENV"; then sed -i "s#^$1=.*#$1=$2#" "$ENV"; else echo "$1=$2" >> "$ENV"; fi; }
set_env CONTROL_DATABASE_URL "$CONTROL_URL"
set_env CONTROL_HOST "$CONTROL"
set_env TENANT_BASE_DOMAIN "$BASE"
set_env TENANT_POOL_MAX 3
set_env COOKIE_SECURE true
chown $APP_USER:$APP_USER "$ENV"; chmod 600 "$ENV"

step "Uploads → one folder per sanstha"
UPLOADS=$(grep -E '^UPLOAD_DIR=' "$ENV" | cut -d= -f2- || true); UPLOADS=${UPLOADS:-$APP_DIR/uploads}
if [[ -n "$EXISTING" && -d "$UPLOADS" && ! -d "$UPLOADS/$EXISTING" ]]; then
  mkdir -p "$UPLOADS/.move-$EXISTING"
  find "$UPLOADS" -mindepth 1 -maxdepth 1 ! -name ".move-$EXISTING" -exec mv {} "$UPLOADS/.move-$EXISTING/" \;
  mv "$UPLOADS/.move-$EXISTING" "$UPLOADS/$EXISTING"
  chown -R $APP_USER:$APP_USER "$UPLOADS"
  echo "moved current uploads to $UPLOADS/$EXISTING"
fi

step "Caddy (automatic HTTPS) instead of Nginx"
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi
sed "s#__EMAIL__#$EMAIL#" "$APP_DIR/deploy/Caddyfile.saas" > /etc/caddy/Caddyfile
systemctl disable --now nginx 2>/dev/null || true
systemctl enable caddy
systemctl restart caddy

step "Migrations, build, restart"
sudo -u $APP_USER bash -c "cd $APP_DIR && npm run db:migrate && npm run build && (pm2 reload trust-manager || pm2 start ecosystem.config.cjs) && pm2 save"

echo -e "\n\033[1;32mDone.\033[0m Next:"
echo "  1. Owner login:   sudo -u $APP_USER bash -c 'cd $APP_DIR && npm run control:owner'"
echo "  2. Open https://$CONTROL  → Sansthaen → New sanstha"
[[ -n "$EXISTING" ]] && echo "     Register the current client: short name '$EXISTING', tick 'Database already exists', name: $(echo "$DB_URL" | sed -E 's#.*/##')"
echo "  3. Owner Razorpay (online renewals): Control panel → Settings"
