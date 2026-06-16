#!/bin/bash
set -euo pipefail

# Only run in Claude Code remote environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

REPO="${CLAUDE_PROJECT_DIR:-/home/user/SQD-APP}"

echo "Installing backend dependencies..."
cd "$REPO/backend" && npm install

echo "Installing frontend dependencies..."
cd "$REPO/frontend" && npm install

echo "Generating Prisma client..."
cd "$REPO/backend" && npx prisma generate

echo "Session setup complete."
