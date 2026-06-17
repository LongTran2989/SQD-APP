#!/bin/bash
# SQD-APP — Ubuntu VPS deployment script
# Usage: sudo bash deploy.sh your-subdomain.duckdns.org
set -e

if [ -z "$1" ]; then
  echo "Usage: sudo bash deploy.sh your-subdomain.duckdns.org"
  exit 1
fi

DOMAIN=$1
REPO_URL="https://github.com/LongTran2989/SQD-APP.git"
BRANCH="TEST_P1"
DB_NAME="sqd_qa_db"
DB_USER="sqd_user"

# Reuse existing credentials if the app was already deployed, so re-runs
# don't generate a new password that mismatches the existing PostgreSQL user.
if [ -f /app/backend/.env ]; then
  DB_PASSWORD=$(grep -oP '(?<=sqd_user:)[^@]+' /app/backend/.env)
  JWT_SECRET=$(grep -oP '(?<=JWT_SECRET=")[^"]+' /app/backend/.env)
else
  DB_PASSWORD=$(openssl rand -hex 16)
  JWT_SECRET=$(openssl rand -hex 32)
fi

echo ""
echo "============================================"
echo "  SQD-APP Deployment"
echo "  Domain : $DOMAIN"
echo "============================================"
echo ""

# ── 0. Swap space (prevents OOM during Next.js build on 2 GB RAM servers) ────
echo "→ [0/9] Setting up 4 GB swap space..."
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Reduce swap aggressiveness — only use swap when RAM is nearly full
  sysctl vm.swappiness=10
  echo 'vm.swappiness=10' >> /etc/sysctl.conf
  echo "  Swap created."
else
  echo "  Swap already exists — skipping."
fi

# ── 1. System packages ────────────────────────────────────────────────────────
echo "→ [1/9] Updating system and installing packages..."
apt-get update -y && apt-get upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git nginx certbot python3-certbot-nginx \
  postgresql postgresql-contrib ufw

echo "→ Installing PM2..."
npm install -g pm2

# ── 2. Open OS firewall ───────────────────────────────────────────────────────
echo "→ [2/9] Opening firewall ports 80 and 443..."
ufw allow OpenSSH   2>/dev/null || true
ufw allow 80/tcp    2>/dev/null || true
ufw allow 443/tcp   2>/dev/null || true
ufw --force enable  2>/dev/null || true

# ── 3. PostgreSQL ─────────────────────────────────────────────────────────────
echo "→ [3/9] Setting up PostgreSQL..."
sudo -u postgres psql -c "
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_USER') THEN
      CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';
    END IF;
  END
  \$\$;"
# Always sync the password so re-runs stay consistent with .env
sudo -u postgres psql -c "ALTER USER $DB_USER WITH PASSWORD '$DB_PASSWORD';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>/dev/null \
  || echo "  (database already exists — skipping)"

# ── 4. Clone repo ─────────────────────────────────────────────────────────────
echo "→ [4/9] Cloning repository..."
if [ -d "/app/.git" ]; then
  cd /app && git fetch origin && git checkout $BRANCH && git pull origin $BRANCH
else
  git clone -b $BRANCH $REPO_URL /app
fi

# ── 5. Backend ────────────────────────────────────────────────────────────────
echo "→ [5/9] Installing backend dependencies and pushing schema..."
cd /app/backend
cat > .env << EOF
DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME"
JWT_SECRET="$JWT_SECRET"
NODE_ENV=production
ENFORCE_SINGLE_SESSION=true
FRONTEND_ORIGIN=https://$DOMAIN
PORT=5000
# File storage (uploads). Local-disk driver — objects are streamed through the
# backend, never served publicly. STORAGE_LOCAL_ROOT must be a persistent path
# (it is git-ignored so re-deploys never touch it). To migrate to MinIO/S3 later,
# implement the MinIO adapter and set STORAGE_DRIVER=minio.
STORAGE_DRIVER=local
STORAGE_LOCAL_ROOT=/app/backend/storage
EOF
# Persistent storage root for uploaded files (survives re-deploys; git-ignored).
mkdir -p /app/backend/storage
npm install
npx prisma db push
npx prisma db seed

# ── 6. Frontend ───────────────────────────────────────────────────────────────
echo "→ [6/9] Building frontend (takes 2–3 minutes)..."
cd /app/frontend
cat > .env.local << EOF
NEXT_PUBLIC_API_URL=https://$DOMAIN/api
EOF
npm install
npm run build

# ── 7. PM2 ───────────────────────────────────────────────────────────────────
echo "→ [7/9] Starting services with PM2..."
pm2 delete backend  2>/dev/null || true
pm2 delete frontend 2>/dev/null || true

cd /app/backend
pm2 start "npx ts-node src/index.ts" --name backend

cd /app/frontend
pm2 start "npm start" --name frontend

pm2 save
# Register PM2 to auto-start on reboot
env PATH=$PATH:/usr/bin pm2 startup systemd -u root --hp /root 2>&1 \
  | grep "sudo" | bash || true

# ── 8. Nginx ─────────────────────────────────────────────────────────────────
echo "→ [8/9] Configuring nginx..."
cat > /etc/nginx/sites-available/sqd-app << NGINX
server {
    listen 80;
    server_name $DOMAIN;

    # Allow file uploads through the proxy. Matches the backend's absolute
    # memory-safety ceiling (ABSOLUTE_MAX_UPLOAD_BYTES); the per-file policy
    # limit is enforced in the app and is Admin-configurable.
    client_max_body_size 100M;

    # SSE endpoint needs streaming (no buffering)
    location /api/events/ {
        proxy_pass         http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   Connection '';
        proxy_buffering    off;
        proxy_cache        off;
        proxy_read_timeout 24h;
    }

    location /api/ {
        proxy_pass         http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For  \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
    }

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINX

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/sqd-app /etc/nginx/sites-enabled/sqd-app
nginx -t && systemctl reload nginx

# ── 9. SSL certificate ────────────────────────────────────────────────────────
echo "→ [9/9] Getting SSL certificate from Let's Encrypt..."
certbot --nginx -d $DOMAIN \
  --non-interactive --agree-tos \
  --email "admin@$DOMAIN" \
  --redirect

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "============================================"
echo "  ✅  Deployment complete!"
echo ""
echo "  URL   : https://$DOMAIN"
echo "  Login : director@sqd.com"
echo "  Pass  : password123"
echo ""
echo "  Useful commands:"
echo "    pm2 status          — check if services are running"
echo "    pm2 logs backend    — backend logs"
echo "    pm2 logs frontend   — frontend logs"
echo "    pm2 restart all     — restart both services"
echo "============================================"
echo ""
