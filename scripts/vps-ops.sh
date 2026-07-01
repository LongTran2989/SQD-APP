#!/bin/bash
# scripts/vps-ops.sh — reusable, flag-driven VPS operations for SQD-APP.
#
# Lives on the VPS at /app/scripts/vps-ops.sh (deployed via git pull like any
# other file). Invoked over SSH, e.g.:
#
#   ssh root@your-server-ip 'bash /app/scripts/vps-ops.sh --pull --status'
#
#   ssh root@your-server-ip 'bash /app/scripts/vps-ops.sh \
#     --pull --install --reset-db --yes-i-am-sure --seed-mockup \
#     --set-sheet-url="https://docs.google.com/spreadsheets/d/XXX/export?format=csv&gid=0" \
#     --restart-all'
#
# Each flag is an independent step; combine only the ones you need. Steps run
# in a fixed, safe order (pull -> install -> stop -> reset-db -> seed-mockup
# -> env edits -> build -> restart -> status) regardless of the order flags
# were passed in.
#
# This is a thin, scriptable version of the manual steps in
# TEST_P1_DEPLOYMENT_GUIDE.md — read that file for the full narrative
# explanation of what each step does and when to use it.
set -e

APP_DIR="/app"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"
ENV_FILE="$BACKEND_DIR/.env"
BRANCH="TEST_P1"

usage() {
  cat <<'EOF'
Usage: bash vps-ops.sh [flags]

Code sync:
  --pull                    git fetch + checkout + pull $BRANCH in /app

Dependencies:
  --install                 npm install in backend/ and frontend/

Database (DESTRUCTIVE — requires --yes-i-am-sure):
  --reset-db                npx prisma migrate reset --force (drops DB, replays
                             migrations, runs base seed.ts automatically)
  --yes-i-am-sure            required alongside --reset-db, confirms you mean it
  --seed-mockup              runs prisma/seed-mass-mockup-v2.ts (idempotent,
                             must come after --reset-db or an existing base seed)

.env edits (backend/.env, created if missing):
  --set-sheet-url=<url>            sets GOOGLE_SHEET_CSV_URL
  --set-chk-blueprint=<name>       sets SHEET_CHK_BLUEPRINT_NAME
  --set-pceq-blueprint=<name>      sets SHEET_PC_EQ_BLUEPRINT_NAME

Build / restart:
  --build-frontend           npm run build in frontend/
  --restart-backend          pm2 restart backend
  --restart-frontend         pm2 restart frontend
  --restart-all              pm2 restart backend frontend

Diagnostics:
  --status                   pm2 status + npx prisma migrate status

  -h, --help                 show this help
EOF
}

PULL=false
INSTALL=false
RESET_DB=false
CONFIRM_RESET=false
SEED_MOCKUP=false
BUILD_FRONTEND=false
RESTART_BACKEND=false
RESTART_FRONTEND=false
RESTART_ALL=false
STATUS=false
SHEET_URL=""
CHK_NAME=""
PCEQ_NAME=""

if [ $# -eq 0 ]; then
  usage
  exit 0
fi

for arg in "$@"; do
  case $arg in
    --pull) PULL=true ;;
    --install) INSTALL=true ;;
    --reset-db) RESET_DB=true ;;
    --yes-i-am-sure) CONFIRM_RESET=true ;;
    --seed-mockup) SEED_MOCKUP=true ;;
    --build-frontend) BUILD_FRONTEND=true ;;
    --restart-backend) RESTART_BACKEND=true ;;
    --restart-frontend) RESTART_FRONTEND=true ;;
    --restart-all) RESTART_ALL=true ;;
    --status) STATUS=true ;;
    --set-sheet-url=*) SHEET_URL="${arg#*=}" ;;
    --set-chk-blueprint=*) CHK_NAME="${arg#*=}" ;;
    --set-pceq-blueprint=*) PCEQ_NAME="${arg#*=}" ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "Unknown flag: $arg" >&2
      usage
      exit 1
      ;;
  esac
done

if [ "$RESET_DB" = true ] && [ "$CONFIRM_RESET" != true ]; then
  echo "ERROR: --reset-db drops and recreates the database (all data lost)." >&2
  echo "       Re-run with --yes-i-am-sure added to confirm you mean it." >&2
  exit 1
fi

# Sets KEY="value" in $ENV_FILE, replacing an existing line or appending.
set_env_var() {
  local key="$1"
  local value="$2"
  touch "$ENV_FILE"
  if grep -q "^${key}=" "$ENV_FILE"; then
    grep -v "^${key}=" "$ENV_FILE" > "${ENV_FILE}.tmp"
    echo "${key}=\"${value}\"" >> "${ENV_FILE}.tmp"
    mv "${ENV_FILE}.tmp" "$ENV_FILE"
  else
    echo "${key}=\"${value}\"" >> "$ENV_FILE"
  fi
  echo "  set ${key} in $ENV_FILE"
}

if [ "$PULL" = true ]; then
  echo "==> Pulling latest $BRANCH"
  cd "$APP_DIR"
  git fetch origin
  git checkout "$BRANCH"
  git pull origin "$BRANCH"
fi

if [ "$INSTALL" = true ]; then
  echo "==> Installing backend dependencies"
  cd "$BACKEND_DIR"
  npm install
  npx prisma generate
  echo "==> Installing frontend dependencies"
  cd "$FRONTEND_DIR"
  npm install
fi

if [ "$RESET_DB" = true ] || [ "$SEED_MOCKUP" = true ]; then
  echo "==> Stopping backend before touching the database"
  pm2 stop backend 2>/dev/null || true
fi

if [ "$RESET_DB" = true ]; then
  echo "==> Resetting database (drop, recreate, replay migrations, run seed.ts)"
  cd "$BACKEND_DIR"
  npx prisma generate
  npx prisma migrate reset --force
fi

if [ "$SEED_MOCKUP" = true ]; then
  echo "==> Seeding mock-up data (seed-mass-mockup-v2.ts)"
  cd "$BACKEND_DIR"
  node node_modules/ts-node/dist/bin.js prisma/seed-mass-mockup-v2.ts
fi

if [ -n "$SHEET_URL" ]; then
  echo "==> Updating GOOGLE_SHEET_CSV_URL"
  set_env_var "GOOGLE_SHEET_CSV_URL" "$SHEET_URL"
fi

if [ -n "$CHK_NAME" ]; then
  echo "==> Updating SHEET_CHK_BLUEPRINT_NAME"
  set_env_var "SHEET_CHK_BLUEPRINT_NAME" "$CHK_NAME"
fi

if [ -n "$PCEQ_NAME" ]; then
  echo "==> Updating SHEET_PC_EQ_BLUEPRINT_NAME"
  set_env_var "SHEET_PC_EQ_BLUEPRINT_NAME" "$PCEQ_NAME"
fi

if [ "$BUILD_FRONTEND" = true ]; then
  echo "==> Building frontend"
  cd "$FRONTEND_DIR"
  npm run build
fi

if [ "$RESTART_ALL" = true ]; then
  echo "==> Restarting backend + frontend"
  pm2 restart backend frontend
elif [ "$RESTART_BACKEND" = true ] && [ "$RESTART_FRONTEND" = true ]; then
  echo "==> Restarting backend + frontend"
  pm2 restart backend frontend
else
  if [ "$RESTART_BACKEND" = true ]; then
    echo "==> Restarting backend"
    pm2 restart backend
  fi
  if [ "$RESTART_FRONTEND" = true ]; then
    echo "==> Restarting frontend"
    pm2 restart frontend
  fi
fi

if [ "$RESET_DB" = true ] || [ "$SEED_MOCKUP" = true ]; then
  if [ "$RESTART_ALL" != true ] && [ "$RESTART_BACKEND" != true ]; then
    echo "==> Restarting backend (was stopped for DB work, no explicit restart flag given)"
    pm2 restart backend 2>/dev/null || pm2 start "npx ts-node src/index.ts" --name backend --cwd "$BACKEND_DIR"
  fi
fi

if [ "$STATUS" = true ]; then
  echo "==> pm2 status"
  pm2 status
  echo "==> migrate status"
  cd "$BACKEND_DIR"
  npx prisma migrate status
fi

echo "Done."
