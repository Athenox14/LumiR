#!/bin/bash
set -e

APP_NAME="lumir"
REPO="Athenox14/LumiR"
INSTALL_DIR="/opt/$APP_NAME"
SERVICE_NAME="$APP_NAME"
SERVICE_FILE="/etc/systemd/system/$SERVICE_NAME.service"
ENV_FILE="$INSTALL_DIR/.env"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()   { echo -e "${CYAN}[LumiR]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
fail()  { echo -e "${RED}[X]${NC} $1"; exit 1; }

usage() {
  echo ""
  echo "Usage: sudo bash install.sh [options]"
  echo ""
  echo "Options:"
  echo "  --port      Port de l'application (defaut: 3000)"
  echo "  --smb       Partage SMB (ex: //192.168.1.100/Films)"
  echo "  --smb-user  Utilisateur SMB"
  echo "  --smb-pass  Mot de passe SMB"
  echo "  --smb-mount Point de montage (defaut: /mnt/lumir-media)"
  echo "  --help      Afficher cette aide"
  echo ""
  exit 1
}

PORT=3000
SMB_SHARE=""
SMB_USER=""
SMB_PASS=""
SMB_MOUNT="/mnt/lumir-media"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)      PORT="$2"; shift 2 ;;
    --smb)       SMB_SHARE="$2"; shift 2 ;;
    --smb-user)  SMB_USER="$2"; shift 2 ;;
    --smb-pass)  SMB_PASS="$2"; shift 2 ;;
    --smb-mount) SMB_MOUNT="$2"; shift 2 ;;
    --help)      usage ;;
    *)           fail "Argument inconnu: $1" ;;
  esac
done

if [ "$EUID" -ne 0 ]; then
  fail "Ce script doit etre execute en tant que root (sudo)"
fi

log "Verification des dependances..."

if ! command -v node >/dev/null 2>&1; then
  fail "Node.js n'est pas installe. Installez Node.js 20+ avant de continuer."
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  fail "Node.js 18+ est requis (version actuelle: $(node -v))"
fi
ok "Node.js $(node -v)"

if ! command -v unzip >/dev/null 2>&1; then
  log "Installation de unzip..."
  apt-get update -qq && apt-get install -y -qq unzip > /dev/null 2>&1
fi
ok "unzip disponible"

if ! command -v curl >/dev/null 2>&1; then
  fail "curl n'est pas installe"
fi
ok "curl disponible"

if [ -n "$SMB_SHARE" ]; then
  log "Configuration du partage SMB..."

  if ! dpkg -s cifs-utils >/dev/null 2>&1; then
    apt-get update -qq && apt-get install -y -qq cifs-utils > /dev/null 2>&1
  fi

  mkdir -p "$SMB_MOUNT"

  SMB_CRED_FILE="/etc/lumir-smb-credentials"
  if [ -n "$SMB_USER" ]; then
    cat > "$SMB_CRED_FILE" <<CREDEOF
username=$SMB_USER
password=$SMB_PASS
CREDEOF
    chmod 600 "$SMB_CRED_FILE"
    MOUNT_OPTS="credentials=$SMB_CRED_FILE,uid=www-data,gid=www-data,iocharset=utf8,vers=3.0,_netdev,nofail"
  else
    MOUNT_OPTS="guest,uid=www-data,gid=www-data,iocharset=utf8,vers=3.0,_netdev,nofail"
  fi

  FSTAB_ENTRY="$SMB_SHARE  $SMB_MOUNT  cifs  $MOUNT_OPTS  0  0"
  if ! grep -qF "$SMB_SHARE" /etc/fstab; then
    echo "" >> /etc/fstab
    echo "# LumiR - Partage media SMB" >> /etc/fstab
    echo "$FSTAB_ENTRY" >> /etc/fstab
  fi

  if ! mountpoint -q "$SMB_MOUNT"; then
    mount "$SMB_MOUNT" || warn "Impossible de monter le partage SMB maintenant."
  fi
fi

log "Recuperation de la derniere release de $REPO..."

GITHUB_API="https://api.github.com/repos/$REPO/releases/latest"
RELEASE_JSON=$(curl -sS -H "Accept: application/vnd.github+json" -H "User-Agent: LumiR-Installer" "$GITHUB_API")

if echo "$RELEASE_JSON" | grep -q '"message"'; then
  MSG=$(echo "$RELEASE_JSON" | grep -o '"message":"[^"]*"' | head -1 | cut -d'"' -f4)
  fail "Erreur GitHub API: $MSG"
fi

eval "$(echo "$RELEASE_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(f'TAG_NAME=\"{data.get(\"tag_name\", \"\")}\"')
print(f'RELEASE_NAME=\"{data.get(\"name\", \"\")}\"')
for asset in data.get('assets', []):
    if asset['name'].endswith('.zip'):
        print(f'DOWNLOAD_URL=\"{asset.get(\"browser_download_url\", \"\")}\"')
        break
")"

if [ -z "$DOWNLOAD_URL" ] || [ -z "$TAG_NAME" ]; then
  fail "Impossible de recuperer une release zip valide"
fi

TMP_DIR=$(mktemp -d)
ZIP_PATH="$TMP_DIR/lumir.zip"

log "Telechargement en cours..."
curl -L -sS -H "User-Agent: LumiR-Installer" -o "$ZIP_PATH" "$DOWNLOAD_URL"

if ! file "$ZIP_PATH" | grep -qi "zip"; then
  fail "Le fichier telecharge n'est pas un zip valide"
fi

mkdir -p "$INSTALL_DIR"

if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  systemctl stop "$SERVICE_NAME"
fi

if [ -d "$INSTALL_DIR/.output" ]; then
  rm -rf "$INSTALL_DIR/.output.old"
  mv "$INSTALL_DIR/.output" "$INSTALL_DIR/.output.old"
fi

unzip -o -q "$ZIP_PATH" -d "$INSTALL_DIR/.output"

if [ ! -f "$ENV_FILE" ]; then
  SESSION_SECRET=$(openssl rand -hex 32)
  JWT_SECRET_VAL=$(openssl rand -hex 32)
  cat > "$ENV_FILE" <<ENVEOF
PORT=$PORT
NODE_ENV=production
HOST=0.0.0.0
NUXT_HOST=0.0.0.0
NUXT_SESSION_PASSWORD=$SESSION_SECRET
JWT_SECRET=$JWT_SECRET_VAL
DATABASE_PATH=./data/lumir.db
ENVEOF
  chmod 600 "$ENV_FILE"
fi

echo "$TAG_NAME" > "$INSTALL_DIR/BUILD_VERSION"
chown -R www-data:www-data "$INSTALL_DIR"
rm -rf "$TMP_DIR"

NODE_PATH=$(which node)
AFTER_TARGETS="network.target"
if [ -n "$SMB_SHARE" ]; then
  AFTER_TARGETS="network.target remote-fs.target"
fi

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=LumiR Media Server
After=$AFTER_TARGETS

[Service]
Type=simple
User=www-data
WorkingDirectory=$INSTALL_DIR
ExecStart=$NODE_PATH $INSTALL_DIR/.output/server/index.mjs
Restart=always
RestartSec=5
EnvironmentFile=$ENV_FILE

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME" > /dev/null 2>&1
systemctl start "$SERVICE_NAME"

ok "LumiR installe avec succes."
