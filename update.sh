#!/bin/bash
set -e

APP_NAME="lumir"
REPO="Athenox14/LumiR"
INSTALL_DIR="/opt/$APP_NAME"
SERVICE_NAME="$APP_NAME"

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
  echo "Usage: sudo bash update.sh [options]"
  echo ""
  echo "Options:"
  echo "  --version   Version specifique a installer (ex: v0.0.3)"
  echo "  --help      Afficher cette aide"
  echo ""
  exit 1
}

TARGET_VERSION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) TARGET_VERSION="$2"; shift 2 ;;
    --help)    usage ;;
    *)         fail "Argument inconnu: $1" ;;
  esac
done

if [ "$EUID" -ne 0 ]; then
  fail "Ce script doit etre execute en tant que root (sudo)"
fi

if [ ! -d "$INSTALL_DIR" ]; then
  fail "LumiR n'est pas installe dans $INSTALL_DIR. Utilisez install.sh d'abord."
fi

CURRENT_VERSION="inconnu"
if [ -f "$INSTALL_DIR/BUILD_VERSION" ]; then
  CURRENT_VERSION=$(cat "$INSTALL_DIR/BUILD_VERSION")
fi

if [ -n "$TARGET_VERSION" ]; then
  GITHUB_API="https://api.github.com/repos/$REPO/releases/tags/$TARGET_VERSION"
else
  GITHUB_API="https://api.github.com/repos/$REPO/releases/latest"
fi

RELEASE_JSON=$(curl -sS -H "Accept: application/vnd.github+json" -H "User-Agent: LumiR-Updater" "$GITHUB_API")

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

if [ "$CURRENT_VERSION" = "$TAG_NAME" ]; then
  ok "Vous etes deja a jour ($TAG_NAME)"
  exit 0
fi

TMP_DIR=$(mktemp -d)
ZIP_PATH="$TMP_DIR/lumir.zip"

log "Telechargement en cours..."
curl -L -sS -H "User-Agent: LumiR-Updater" -o "$ZIP_PATH" "$DOWNLOAD_URL"

if ! file "$ZIP_PATH" | grep -qi "zip"; then
  fail "Le fichier telecharge n'est pas un zip valide"
fi

if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  systemctl stop "$SERVICE_NAME"
fi

if [ -d "$INSTALL_DIR/.output" ]; then
  rm -rf "$INSTALL_DIR/.output.old"
  mv "$INSTALL_DIR/.output" "$INSTALL_DIR/.output.old"
fi

unzip -o -q "$ZIP_PATH" -d "$INSTALL_DIR/.output"
echo "$TAG_NAME" > "$INSTALL_DIR/BUILD_VERSION"
chown -R www-data:www-data "$INSTALL_DIR"
rm -rf "$TMP_DIR"

systemctl start "$SERVICE_NAME"
sleep 2
if ! systemctl is-active --quiet "$SERVICE_NAME"; then
  warn "Le service semble ne pas avoir demarre correctement."
  if [ -d "$INSTALL_DIR/.output.old" ]; then
    rm -rf "$INSTALL_DIR/.output"
    mv "$INSTALL_DIR/.output.old" "$INSTALL_DIR/.output"
    echo "$CURRENT_VERSION" > "$INSTALL_DIR/BUILD_VERSION"
    chown -R www-data:www-data "$INSTALL_DIR"
    systemctl start "$SERVICE_NAME"
  fi
  fail "Verifiez les logs avec: journalctl -u $SERVICE_NAME -f"
fi

rm -rf "$INSTALL_DIR/.output.old"
ok "LumiR mis a jour avec succes."
