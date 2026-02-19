#!/usr/bin/env bash
# reset-admin-password.sh
#
# Resets the admin account password directly in the database.
# Run this from the project root (where docker-compose.yml lives) if you've
# lost access to the admin account and can't use the in-app reset flow.
#
# Usage:
#   ./backend/reset-admin-password.sh
#
# You will be prompted for the admin email and the new password.
# The script hashes the password with bcrypt (cost 10) before writing it,
# exactly the same way the server does at runtime.

set -euo pipefail

# ── Load .env if present so PG_* vars are available ──────────────────────────
if [ -f .env ]; then
  # shellcheck disable=SC2046
  export $(grep -v '^#' .env | xargs)
fi

PG_USER="${PG_USER:-trivia_user}"
PG_DB="${PG_DB:-trivia_db}"
CONTAINER="${DB_CONTAINER:-$(docker compose ps -q db 2>/dev/null || echo '')}"

if [ -z "$CONTAINER" ]; then
  echo "❌  Could not find the running 'db' container."
  echo "    Make sure 'docker compose up' is running before using this script."
  exit 1
fi

# ── Prompt ────────────────────────────────────────────────────────────────────
read -rp "Admin email [admin@trivia.com]: " ADMIN_EMAIL
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@trivia.com}"

while true; do
  read -rsp "New password (min 6 chars): " NEW_PASSWORD
  echo
  if [ "${#NEW_PASSWORD}" -lt 6 ]; then
    echo "⚠️  Password must be at least 6 characters. Try again."
  else
    break
  fi
done

read -rsp "Confirm new password: " CONFIRM_PASSWORD
echo

if [ "$NEW_PASSWORD" != "$CONFIRM_PASSWORD" ]; then
  echo "❌  Passwords do not match. Aborting."
  exit 1
fi

# ── Hash with bcrypt via Node (same cost factor the server uses) ──────────────
echo "⏳  Hashing password…"
HASHED=$(docker compose exec -T backend node -e "
  const b = require('bcryptjs');
  b.hash('${NEW_PASSWORD//\'/\'\\\'\'}', 10).then(h => process.stdout.write(h));
")

if [ -z "$HASHED" ]; then
  echo "❌  Failed to generate hash. Is the backend container running?"
  exit 1
fi

# ── Write to DB ───────────────────────────────────────────────────────────────
ROWS=$(docker compose exec -T db psql -U "$PG_USER" -d "$PG_DB" -tAc \
  "UPDATE users SET password_hash='${HASHED}' WHERE email='${ADMIN_EMAIL}' AND is_anonymous=FALSE; SELECT ROW_COUNT();")

# psql UPDATE doesn't return ROW_COUNT() — check via SELECT instead
UPDATED=$(docker compose exec -T db psql -U "$PG_USER" -d "$PG_DB" -tAc \
  "SELECT COUNT(*) FROM users WHERE email='${ADMIN_EMAIL}' AND is_anonymous=FALSE;")

if [ "${UPDATED// /}" = "0" ]; then
  echo "⚠️  No user found with email '${ADMIN_EMAIL}'. Password was NOT changed."
  echo "    Check the email address and try again."
  exit 1
fi

echo "✅  Password updated for ${ADMIN_EMAIL}."
echo "    You can now log in at the Open-Trivia admin panel."
