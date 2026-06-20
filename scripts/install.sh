#!/usr/bin/env bash
# WebPanel install script
set -euo pipefail

PANEL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "==> WebPanel dir: $PANEL_DIR"

cd "$PANEL_DIR/backend"

if [ ! -f .env ]; then
  cp .env.example .env
  # Generate random JWT secret
  SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | base64)
  sed -i "s|change-me-to-a-long-random-string|$SECRET|" .env
  echo "==> Created .env with random JWT secret"
  echo "==> IMPORTANT: edit ADMIN_PASSWORD in $PANEL_DIR/backend/.env"
fi

echo "==> Installing npm deps"
npm install --no-audit --no-fund

echo "==> Installing systemd unit"
cp "$PANEL_DIR/scripts/webpanel.service" /etc/systemd/system/webpanel.service
systemctl daemon-reload
systemctl enable webpanel
systemctl restart webpanel
sleep 2
systemctl status webpanel --no-pager -l | head -20

PORT=$(grep -E '^PORT=' "$PANEL_DIR/backend/.env" | cut -d= -f2)
echo ""
echo "==> Done!"
echo "==> Open: http://<server-ip>:${PORT:-8787}"
echo "==> Default login: admin / admin  (change in .env!)"
