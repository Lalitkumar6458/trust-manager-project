#!/usr/bin/env bash
# ======================================================================
# Trust Manager – one-time setup of a fresh Hostinger VPS (Ubuntu 22.04 / 24.04)
#
#   (needs a terminal: the script waits while you add the GitHub deploy key)
#   (from the Mac)  scp deploy/setup-vps.sh root@<VPS-IP>:/root/  &&  ssh -t root@<VPS-IP>
#   sudo bash setup-vps.sh trust.example.org you@example.org git@github.com:<you>/<repo>.git
#
# Installs: Node.js 22, PostgreSQL 16, Nginx, Certbot (free SSL), PM2, UFW firewall, fail2ban
# Creates : linux user "trust", database "trust" (random password), /var/www/trust-manager,
#           uploads in /var/lib/trust-manager/uploads, nightly backups in /var/backups/trust-manager,
#           cron jobs (monthly report, daily digest, next FY, backup)
# Safe to run again (skips what already exists).
# ======================================================================
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
REPO="${3:-}"
APP_USER=trust
APP_DIR=/var/www/trust-manager
DATA_DIR=/var/lib/trust-manager
BACKUP_DIR=/var/backups/trust-manager
LOG_DIR=/var/log/trust-manager
DB_NAME=trust
DB_USER=trust

if [[ $EUID -ne 0 ]]; then echo "Run as root:  sudo bash $0 …"; exit 1; fi
if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "Usage: sudo bash $0 <domain> <email-for-ssl> [git-repo-url]"
  echo "   eg: sudo bash $0 trust.example.org admin@example.org git@github.com:me/trust-manager-project.git"
  exit 1
fi
step() { echo -e "\n\033[1;32m==> $*\033[0m"; }

step "System update + basic tools"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl git ufw fail2ban ca-certificates gnupg build-essential unattended-upgrades rclone
timedatectl set-timezone Asia/Kolkata || true

step "Node.js 22"
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1)" != "v22" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2@latest

step "PostgreSQL 16"
if ! command -v psql >/dev/null; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  apt-get update -y
  apt-get install -y postgresql-16
fi
systemctl enable --now postgresql

step "Linux user + folders"
id -u $APP_USER >/dev/null 2>&1 || adduser --system --group --home /home/$APP_USER --shell /bin/bash $APP_USER
mkdir -p $APP_DIR $DATA_DIR/uploads $BACKUP_DIR $LOG_DIR
chown -R $APP_USER:$APP_USER $APP_DIR $DATA_DIR $BACKUP_DIR $LOG_DIR
chmod 750 $DATA_DIR $BACKUP_DIR

step "Database"
DB_PASS_FILE=/root/.trust-db-password
if [[ ! -f $DB_PASS_FILE ]]; then
  openssl rand -base64 30 | tr -dc 'A-Za-z0-9' | head -c 32 > $DB_PASS_FILE
  chmod 600 $DB_PASS_FILE
fi
DB_PASS=$(cat $DB_PASS_FILE)
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS';"
sudo -u postgres psql -c "ALTER ROLE $DB_USER PASSWORD '$DB_PASS';" >/dev/null
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
# PostgreSQL listens on localhost only (default) – it is never reachable from the internet

step "Get the app code"
if [[ ! -f $APP_DIR/package.json ]]; then
  if [[ -n "$REPO" ]]; then
    sudo -u $APP_USER mkdir -p /home/$APP_USER/.ssh
    if [[ ! -f /home/$APP_USER/.ssh/id_ed25519 ]]; then
      sudo -u $APP_USER ssh-keygen -t ed25519 -N "" -f /home/$APP_USER/.ssh/id_ed25519 -C "trust-vps-deploy" >/dev/null
    fi
    sudo -u $APP_USER bash -c "ssh-keyscan github.com >> /home/$APP_USER/.ssh/known_hosts 2>/dev/null"
    echo
    echo "------------------------------------------------------------------"
    echo " Add this key in GitHub → your repo → Settings → Deploy keys (read-only):"
    echo
    cat /home/$APP_USER/.ssh/id_ed25519.pub
    echo "------------------------------------------------------------------"
    read -r -p "Press ENTER after adding the deploy key… "
    sudo -u $APP_USER git clone "$REPO" $APP_DIR
  else
    echo "No repo given – copy the project into $APP_DIR (eg. with deploy/push-from-mac.sh) and run this script again."
    exit 0
  fi
fi
chown -R $APP_USER:$APP_USER $APP_DIR

step ".env.local"
ENV_FILE=$APP_DIR/.env.local
if [[ ! -f $ENV_FILE ]]; then
  cat > $ENV_FILE <<EOF
DATABASE_URL=postgres://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME
UPLOAD_DIR=$DATA_DIR/uploads
CRON_SECRET=$(openssl rand -hex 24)
TZ=Asia/Kolkata
COOKIE_SECURE=true
EOF
  chown $APP_USER:$APP_USER $ENV_FILE
  chmod 600 $ENV_FILE
fi
CRON_SECRET=$(grep ^CRON_SECRET= $ENV_FILE | cut -d= -f2)

step "Install, migrate, build"
sudo -u $APP_USER bash -c "cd $APP_DIR && npm ci --no-audit --no-fund && npm run db:migrate && npm run build"

step "Start with PM2 (auto-start on reboot)"
sudo -u $APP_USER bash -c "cd $APP_DIR && pm2 start ecosystem.config.cjs || pm2 reload trust-manager"
sudo -u $APP_USER pm2 save
env PATH=$PATH:/usr/bin pm2 startup systemd -u $APP_USER --hp /home/$APP_USER >/dev/null
systemctl enable pm2-$APP_USER >/dev/null 2>&1 || true

step "Nginx + SSL"
apt-get install -y nginx certbot python3-certbot-nginx
sed "s/__DOMAIN__/$DOMAIN/g" $APP_DIR/deploy/nginx.conf > /etc/nginx/sites-available/trust-manager
ln -sf /etc/nginx/sites-available/trust-manager /etc/nginx/sites-enabled/trust-manager
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || echo "!! SSL failed – check that the domain's DNS A record points to this server, then run: certbot --nginx -d $DOMAIN"

step "Cron: scheduled jobs + nightly backup"
CRON_FILE=/etc/cron.d/trust-manager
cat > $CRON_FILE <<EOF
# Trust Manager (times are India time – server time zone is Asia/Kolkata)
SHELL=/bin/bash
5 6 1 * *  $APP_USER curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:3000/api/cron/monthly-report >> $LOG_DIR/cron.log 2>&1
0 9 * * *  $APP_USER curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:3000/api/cron/daily-digest >> $LOG_DIR/cron.log 2>&1
15 1 * 3 * $APP_USER curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:3000/api/cron/next-fy >> $LOG_DIR/cron.log 2>&1
30 8 * * * $APP_USER curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:3000/api/cron/special-days >> $LOG_DIR/cron.log 2>&1
40 9 * * * $APP_USER curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:3000/api/cron/pledge-reminders >> $LOG_DIR/cron.log 2>&1
30 2 * * *  $APP_USER bash $APP_DIR/deploy/backup.sh >> $LOG_DIR/backup.log 2>&1
EOF
chmod 644 $CRON_FILE

step "Log rotation"
cat > /etc/logrotate.d/trust-manager <<EOF
$LOG_DIR/*.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
  copytruncate
}
EOF

step "Automatic security updates + fail2ban"
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades || true

echo
echo "=================================================================="
echo " ✔ Done.  Open  https://$DOMAIN/setup  (new trust)  or move the old"
echo "   Firebase data first:  see README → 'Firebase se data laana'."
echo
echo "   App logs:      sudo -u $APP_USER pm2 logs trust-manager"
echo "   Update app:    sudo -u $APP_USER bash $APP_DIR/deploy/deploy.sh"
echo "   DB password:   $DB_PASS_FILE (also inside $ENV_FILE)"
echo "   Backups:       $BACKUP_DIR (every night 02:30) – copy them off the server too!"
echo "=================================================================="
