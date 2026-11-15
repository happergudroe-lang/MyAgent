#!/usr/bin/env bash
set -euo pipefail

# Run on a fresh Ubuntu 22.04/24.04 ARM64 VM as root:
# bash /opt/myagent/deploy/oracle-cloud-setup.sh
REPO_URL="${MYAGENT_REPO_URL:-https://github.com/happergudroe-lang/MyAgent.git}"
APP_DIR="/opt/myagent"
APP_USER="myagent"
ENV_DIR="/etc/myagent"
DATA_DIR="/var/lib/myagent"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Please run this script as root (sudo)." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git nginx ufw build-essential

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$ENV_DIR" "$DATA_DIR"
chown -R "$APP_USER:$APP_USER" "$DATA_DIR"

if [[ ! -d "$APP_DIR/.git" ]]; then
  git clone "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" pull --ff-only
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && npm install && npm run build"

if [[ ! -f "$ENV_DIR/myagent.env" ]]; then
  cat > "$ENV_DIR/myagent.env" <<'EOF'
NODE_ENV=production
PORT=3001
DATABASE_PATH=/var/lib/myagent/myagent.sqlite
# Add at least one provider key below. Never commit this file.
# OPENAI_API_KEY=
# DEEPSEEK_API_KEY=
# ANTHROPIC_API_KEY=
# GEMINI_API_KEY=
# QWEN_API_KEY=
# TAVILY_API_KEY=
EOF
  chmod 600 "$ENV_DIR/myagent.env"
  echo "Created $ENV_DIR/myagent.env. Add a model API key before testing chat."
fi

cat > /etc/systemd/system/myagent.service <<EOF
[Unit]
Description=MyAgent application
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_DIR/myagent.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$DATA_DIR
UMask=0077

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/nginx/sites-available/myagent <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
EOF

ln -sf /etc/nginx/sites-available/myagent /etc/nginx/sites-enabled/myagent
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl restart nginx
systemctl daemon-reload
systemctl enable myagent
systemctl restart myagent

ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo
echo "MyAgent deployment bootstrap finished."
echo "1) Edit $ENV_DIR/myagent.env and add at least one provider API key."
echo "2) Run: systemctl restart myagent"
echo "3) Check: curl http://127.0.0.1:3001/api/health"
echo "4) Open TCP ports 22, 80 and 443 in the Oracle VCN security list / NSG."
echo "5) Configure DNS and HTTPS before inviting testers."
