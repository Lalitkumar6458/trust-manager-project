#!/usr/bin/env bash
# ======================================================================
# Trust Manager – set up your Mac for development (PostgreSQL + Node.js)
#   cd trust-manager-project
#   bash scripts/setup-mac.sh
# Safe to run again.
# ======================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
step() { echo -e "\n\033[1;32m==> $*\033[0m"; }

if ! command -v brew >/dev/null; then
  echo "Homebrew is not installed. Install it first (one line, from https://brew.sh):"
  echo '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  echo "then run this script again."
  exit 1
fi

step "Node.js 22 + PostgreSQL 16 (Homebrew)"
brew list node@22 >/dev/null 2>&1 || brew install node@22
brew list postgresql@16 >/dev/null 2>&1 || brew install postgresql@16
PG_BIN="$(brew --prefix postgresql@16)/bin"
NODE_BIN="$(brew --prefix node@22)/bin"
export PATH="$NODE_BIN:$PG_BIN:$PATH"
brew services start postgresql@16 >/dev/null
SHELL_RC="$HOME/.zshrc"
if ! grep -q "postgresql@16/bin" "$SHELL_RC" 2>/dev/null; then
  { echo ''; echo '# Trust Manager: Node 22 + PostgreSQL 16'; echo "export PATH=\"$NODE_BIN:$PG_BIN:\$PATH\""; } >> "$SHELL_RC"
  echo "   (added Node 22 + PostgreSQL to PATH in $SHELL_RC – open a new terminal tab afterwards)"
fi

step "Waiting for PostgreSQL"
for i in {1..20}; do pg_isready -q && break; sleep 1; done
pg_isready || { echo "PostgreSQL did not start: brew services restart postgresql@16"; exit 1; }

step "Database 'trust' (user trust / password trust – local only)"
psql -d postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='trust'" | grep -q 1 || psql -d postgres -c "CREATE ROLE trust LOGIN PASSWORD 'trust' CREATEDB;"
psql -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='trust'" | grep -q 1 || psql -d postgres -c "CREATE DATABASE trust OWNER trust;"

step ".env.local"
if [[ -f .env.local ]] && ! grep -q '^DATABASE_URL=' .env.local; then
  mv .env.local .env.firebase
  echo "   old Firebase settings kept in .env.firebase (needed once, to move the data)"
fi
if [[ ! -f .env.local ]]; then
  cat > .env.local <<ENV
DATABASE_URL=postgres://trust:trust@localhost:5432/trust
CRON_SECRET=$(openssl rand -hex 24)
TZ=Asia/Kolkata
COOKIE_SECURE=false
ENV
  echo "   created .env.local"
fi

step "npm install"
npm install --no-audit --no-fund

step "Create / update tables"
npm run db:migrate

echo
echo "=================================================================="
echo " ✔ Mac ready."
echo "   Start:            npm run dev        → http://localhost:3000"
echo "   New trust:        open http://localhost:3000/setup"
echo "   Old Firebase data: npm run migrate:firebase -- --key ./service-account.json --hash-config ./hash-config.txt"
echo "   (see README → 'Firebase se data laana')"
echo "=================================================================="
