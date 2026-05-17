#!/usr/bin/env bash
# Deploy script for the amazon-ads Next.js app under PM2.
# Run this on the prod box (Jenkins triggers it, or you can run it manually).
#
# What it does:
#   1. Pulls the latest main branch
#   2. Installs any new dependencies
#   3. Wipes the stale .next build (forces a clean rebuild — avoids the
#      classic "old API routes still served" issue after a code change)
#   4. Builds the new Next.js bundle
#   5. Fully restarts PM2 (not reload — reload keeps the old in-memory build)
#   6. Prints the new commit SHA + a 5-line health check so you can confirm
#      it actually picked up the change
#
# Exits non-zero on any failure so Jenkins marks the build red.

set -euo pipefail
cd "$(dirname "$0")/.."

APP_NAME="${APP_NAME:-amazon-ads}"

echo "▶ git pull"
git fetch --quiet origin main
git reset --hard origin/main

NEW_SHA="$(git rev-parse --short HEAD)"
echo "  → at commit $NEW_SHA"

echo "▶ npm install (only fetches what changed)"
npm install --no-audit --no-fund --silent

echo "▶ removing stale .next build directory"
rm -rf .next

echo "▶ npm run build"
npm run build

echo "▶ pm2 restart $APP_NAME"
# `--update-env` so changes in process.env (e.g. ENCRYPTION_SECRET) are picked up.
pm2 restart "$APP_NAME" --update-env

# Give it a couple of seconds to come online before health-checking.
sleep 3

echo
echo "✓ Deployed commit $NEW_SHA"
echo "  PM2 status:"
pm2 info "$APP_NAME" | grep -E "^\│ (status|uptime|restarts|pid)\s" || pm2 info "$APP_NAME" | head -25

echo
echo "▶ Smoke-checking /api/overview returns the new 'prev' field"
# Use the local port from ecosystem.config.js (5012 in this repo).
PORT="${PORT:-5012}"
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/api/accounts" || echo 000)
if [ "$HEALTH" = "200" ]; then
  echo "  ✓ http://localhost:$PORT/api/accounts responding 200"
else
  echo "  ⚠ /api/accounts returned $HEALTH — check 'pm2 logs $APP_NAME'"
  exit 1
fi

echo
echo "Done. Open the dashboard and hard-refresh (Cmd+Shift+R) to load the new bundle."
