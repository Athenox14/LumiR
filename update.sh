#!/bin/bash
set -e

# ============================================
#  LumiR - Script de mise à jour
# ============================================

APP_NAME="lumir"
INSTALL_DIR="/opt/$APP_NAME"
SERVICE_NAME="$APP_NAME"
ENV_FILE="$INSTALL_DIR/.env"

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()   { echo -e "${CYAN}[LumiR]${NC} $1"; }
ok()    { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
fail()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ============================================
#  Usage
# ============================================
usage() {
  echo ""
  echo "Usage: sudo bash update.sh --repo <owner/repo> [options]"
  echo ""
  echo "Options:"
  echo "  --repo      GitHub repository (ex: Athenox14/LumiR)       [requis]"
  echo "  --token     GitHub token (pour les repos privés)            [optionnel]"
  echo "  --version   Version spécifique à installer (ex: v0.0.3)    [optionnel]"
  echo "  --help      Afficher cette aide"
  echo ""
  exit 1
}

# ============================================
#  Parse arguments
# ============================================
REPO=""
TOKEN=""
TARGET_VERSION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)      REPO="$2"; shift 2 ;;
    --token)     TOKEN="$2"; shift 2 ;;
    --version)   TARGET_VERSION="$2"; shift 2 ;;
    --help)      usage ;;
    *)           fail "Argument inconnu: $1" ;;
  esac
done

if [ -z "$REPO" ]; then
  fail "Le paramètre --repo est requis.\n$(usage)"
fi

# ============================================
#  Vérifications
# ============================================
if [ "$EUID" -ne 0 ]; then
  fail "Ce script doit être exécuté en tant que root (sudo)"
fi

if [ ! -d "$INSTALL_DIR" ]; then
  fail "LumiR n'est pas installé dans $INSTALL_DIR. Utilisez install.sh d'abord."
fi

# Version actuelle
CURRENT_VERSION="inconnu"
if [ -f "$INSTALL_DIR/BUILD_VERSION" ]; then
  CURRENT_VERSION=$(cat "$INSTALL_DIR/BUILD_VERSION")
fi
log "Version actuelle : ${CYAN}$CURRENT_VERSION${NC}"

# ============================================
#  Récupération de la release
# ============================================
if [ -n "$TARGET_VERSION" ]; then
  log "Récupération de la version $TARGET_VERSION de $REPO..."
  GITHUB_API="https://api.github.com/repos/$REPO/releases/tags/$TARGET_VERSION"
else
  log "Récupération de la dernière release de $REPO..."
  GITHUB_API="https://api.github.com/repos/$REPO/releases/latest"
fi

CURL_HEADERS=(-H "Accept: application/vnd.github+json" -H "User-Agent: LumiR-Updater")

if [ -n "$TOKEN" ]; then
  CURL_HEADERS+=(-H "Authorization: Bearer $TOKEN")
fi

RELEASE_JSON=$(curl -sS "${CURL_HEADERS[@]}" "$GITHUB_API")

# Vérifier les erreurs
if echo "$RELEASE_JSON" | grep -q '"message"'; then
  MSG=$(echo "$RELEASE_JSON" | grep -o '"message":"[^"]*"' | head -1 | cut -d'"' -f4)
  fail "Erreur GitHub API: $MSG"
fi

# Extraire les infos avec python3
eval "$(echo "$RELEASE_JSON" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(f'TAG_NAME=\"{data.get(\"tag_name\", \"\")}\"')
print(f'RELEASE_NAME=\"{data.get(\"name\", \"\")}\"')
for asset in data.get('assets', []):
    if asset['name'].endswith('.zip'):
        print(f'DOWNLOAD_URL=\"{asset.get(\"browser_download_url\", \"\")}\"')
        print(f'ASSET_API_URL=\"{asset.get(\"url\", \"\")}\"')
        break
")"

if [ -z "$DOWNLOAD_URL" ]; then
  fail "Aucun fichier .zip trouvé dans la release"
fi

if [ -z "$TAG_NAME" ]; then
  fail "Impossible de récupérer la version"
fi

ok "Version trouvée : $RELEASE_NAME ($TAG_NAME)"

# Vérifier si déjà à jour
if [ "$CURRENT_VERSION" = "$TAG_NAME" ]; then
  ok "Vous êtes déjà à jour ($TAG_NAME)"
  exit 0
fi

log "Mise à jour : ${YELLOW}$CURRENT_VERSION${NC} → ${GREEN}$TAG_NAME${NC}"

# ============================================
#  Téléchargement
# ============================================
TMP_DIR=$(mktemp -d)
ZIP_PATH="$TMP_DIR/lumir.zip"

log "Téléchargement en cours..."

if [ -n "$TOKEN" ] && [ -n "$ASSET_API_URL" ]; then
  curl -L -sS \
    -H "Accept: application/octet-stream" \
    -H "User-Agent: LumiR-Updater" \
    -H "Authorization: Bearer $TOKEN" \
    -o "$ZIP_PATH" "$ASSET_API_URL"
else
  curl -L -sS \
    -H "User-Agent: LumiR-Updater" \
    -o "$ZIP_PATH" "$DOWNLOAD_URL"
fi

if [ ! -f "$ZIP_PATH" ]; then
  fail "Échec du téléchargement"
fi

ZIP_SIZE=$(du -h "$ZIP_PATH" | cut -f1)

# Vérifier que c'est bien un zip
if ! file "$ZIP_PATH" | grep -qi "zip"; then
  log "Le fichier téléchargé n'est pas un zip valide. Contenu:"
  head -c 200 "$ZIP_PATH"
  echo ""
  fail "Le téléchargement a échoué (fichier invalide, ${ZIP_SIZE})"
fi

ok "Téléchargé ($ZIP_SIZE)"

# ============================================
#  Installation
# ============================================
log "Arrêt du service..."
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  systemctl stop "$SERVICE_NAME"
  ok "Service arrêté"
else
  warn "Le service n'était pas en cours d'exécution"
fi

# Backup
if [ -d "$INSTALL_DIR/.output" ]; then
  log "Sauvegarde de l'ancienne version..."
  rm -rf "$INSTALL_DIR/.output.old"
  mv "$INSTALL_DIR/.output" "$INSTALL_DIR/.output.old"
  ok "Backup créé (.output.old)"
fi

# Extraire
log "Extraction..."
unzip -o -q "$ZIP_PATH" -d "$INSTALL_DIR/.output"
ok "Extraction terminée"

# Écrire la version
echo "$TAG_NAME" > "$INSTALL_DIR/BUILD_VERSION"

# Permissions
chown -R www-data:www-data "$INSTALL_DIR"

# Nettoyage
rm -rf "$TMP_DIR"
ok "Nettoyage terminé"

# ============================================
#  Redémarrage
# ============================================
log "Démarrage du service..."
systemctl start "$SERVICE_NAME"

sleep 2
if systemctl is-active --quiet "$SERVICE_NAME"; then
  ok "Service $SERVICE_NAME démarré avec succès !"
else
  warn "Le service semble ne pas avoir démarré correctement."
  warn "Restauration de l'ancienne version..."
  if [ -d "$INSTALL_DIR/.output.old" ]; then
    rm -rf "$INSTALL_DIR/.output"
    mv "$INSTALL_DIR/.output.old" "$INSTALL_DIR/.output"
    echo "$CURRENT_VERSION" > "$INSTALL_DIR/BUILD_VERSION"
    chown -R www-data:www-data "$INSTALL_DIR"
    systemctl start "$SERVICE_NAME"
    warn "Ancienne version restaurée. Vérifiez les logs : journalctl -u $SERVICE_NAME -f"
    exit 1
  fi
  fail "Vérifiez les logs avec: journalctl -u $SERVICE_NAME -f"
fi

# Nettoyer le backup si tout va bien
rm -rf "$INSTALL_DIR/.output.old"

# ============================================
#  Résumé
# ============================================
echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  LumiR mis à jour avec succès !${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "  Ancienne version : ${YELLOW}$CURRENT_VERSION${NC}"
echo -e "  Nouvelle version : ${GREEN}$TAG_NAME${NC}"
echo -e "  Répertoire :       ${CYAN}$INSTALL_DIR${NC}"
echo ""
SERVER_IP=$(hostname -I | awk '{print $1}')
echo -e "  Ouvrez ${CYAN}http://$SERVER_IP${NC} dans votre navigateur"
echo ""
