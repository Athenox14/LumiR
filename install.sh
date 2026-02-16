#!/bin/bash
set -e

# ============================================
#  LumiR - Script d'installation
# ============================================

APP_NAME="lumir"
INSTALL_DIR="/opt/$APP_NAME"
SERVICE_NAME="$APP_NAME"
SERVICE_FILE="/etc/systemd/system/$SERVICE_NAME.service"
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
  echo "Usage: sudo bash install.sh --repo <owner/repo> [--token <github_token>] [--port <port>]"
  echo ""
  echo "Options:"
  echo "  --repo    GitHub repository (ex: Athenox14/LumiR)  [requis]"
  echo "  --token   GitHub token (pour les repos privés)      [optionnel]"
  echo "  --port    Port de l'application (défaut: 3000)      [optionnel]"
  echo "  --help    Afficher cette aide"
  echo ""
  exit 1
}

# ============================================
#  Parse arguments
# ============================================
REPO=""
TOKEN=""
PORT=3000

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)   REPO="$2"; shift 2 ;;
    --token)  TOKEN="$2"; shift 2 ;;
    --port)   PORT="$2"; shift 2 ;;
    --help)   usage ;;
    *)        fail "Argument inconnu: $1" ;;
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

log "Vérification des dépendances..."

if ! command -v node &> /dev/null; then
  fail "Node.js n'est pas installé. Installez Node.js 20+ avant de continuer."
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  fail "Node.js 18+ est requis (version actuelle: $(node -v))"
fi
ok "Node.js $(node -v)"

if ! command -v unzip &> /dev/null; then
  log "Installation de unzip..."
  apt-get update -qq && apt-get install -y -qq unzip > /dev/null 2>&1
  ok "unzip installé"
else
  ok "unzip disponible"
fi

if ! command -v curl &> /dev/null; then
  fail "curl n'est pas installé"
fi
ok "curl disponible"

# ============================================
#  Récupération de la dernière release
# ============================================
log "Récupération de la dernière release de $REPO..."

GITHUB_API="https://api.github.com/repos/$REPO/releases/latest"
CURL_HEADERS=(-H "Accept: application/vnd.github+json" -H "User-Agent: LumiR-Installer")

if [ -n "$TOKEN" ]; then
  CURL_HEADERS+=(-H "Authorization: Bearer $TOKEN")
fi

RELEASE_JSON=$(curl -sS "${CURL_HEADERS[@]}" "$GITHUB_API")

# Vérifier les erreurs
if echo "$RELEASE_JSON" | grep -q '"message"'; then
  MSG=$(echo "$RELEASE_JSON" | grep -o '"message":"[^"]*"' | head -1 | cut -d'"' -f4)
  fail "Erreur GitHub API: $MSG"
fi

# Extraire les infos
TAG_NAME=$(echo "$RELEASE_JSON" | grep -o '"tag_name":"[^"]*"' | head -1 | cut -d'"' -f4)
RELEASE_NAME=$(echo "$RELEASE_JSON" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)

# Trouver l'URL du zip
DOWNLOAD_URL=$(echo "$RELEASE_JSON" | grep -o '"browser_download_url":"[^"]*\.zip"' | head -1 | cut -d'"' -f4)

if [ -z "$DOWNLOAD_URL" ]; then
  fail "Aucun fichier .zip trouvé dans la release"
fi

if [ -z "$TAG_NAME" ]; then
  fail "Impossible de récupérer la version"
fi

ok "Version trouvée: $RELEASE_NAME ($TAG_NAME)"
log "URL: $DOWNLOAD_URL"

# ============================================
#  Téléchargement
# ============================================
TMP_DIR=$(mktemp -d)
ZIP_PATH="$TMP_DIR/lumir.zip"

log "Téléchargement en cours..."

DOWNLOAD_HEADERS=(-H "Accept: application/octet-stream" -H "User-Agent: LumiR-Installer")
if [ -n "$TOKEN" ]; then
  DOWNLOAD_HEADERS+=(-H "Authorization: Bearer $TOKEN")
fi

curl -L -sS "${DOWNLOAD_HEADERS[@]}" -o "$ZIP_PATH" "$DOWNLOAD_URL"

if [ ! -f "$ZIP_PATH" ]; then
  fail "Échec du téléchargement"
fi

ZIP_SIZE=$(du -h "$ZIP_PATH" | cut -f1)
ok "Téléchargé ($ZIP_SIZE)"

# ============================================
#  Installation
# ============================================
log "Installation dans $INSTALL_DIR..."

# Créer le répertoire d'installation
mkdir -p "$INSTALL_DIR"

# Stopper le service s'il tourne déjà (mise à jour)
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  warn "Service $SERVICE_NAME en cours d'exécution, arrêt..."
  systemctl stop "$SERVICE_NAME"
fi

# Backup de l'ancien .output si existant
if [ -d "$INSTALL_DIR/.output" ]; then
  log "Sauvegarde de l'ancienne version..."
  rm -rf "$INSTALL_DIR/.output.old"
  mv "$INSTALL_DIR/.output" "$INSTALL_DIR/.output.old"
fi

# Extraire
log "Extraction..."
unzip -o -q "$ZIP_PATH" -d "$INSTALL_DIR/.output"

ok "Extraction terminée"

# Créer le fichier .env s'il n'existe pas
if [ ! -f "$ENV_FILE" ]; then
  log "Création du fichier .env..."
  cat > "$ENV_FILE" <<EOF
# LumiR - Configuration
# Modifiez ce fichier selon vos besoins
PORT=$PORT
NODE_ENV=production
EOF
  ok "Fichier .env créé ($ENV_FILE)"
else
  ok "Fichier .env existant conservé"
fi

# Écrire la version
echo "$TAG_NAME" > "$INSTALL_DIR/BUILD_VERSION"

# Permissions
chown -R www-data:www-data "$INSTALL_DIR"

# Nettoyage
rm -rf "$TMP_DIR"
ok "Nettoyage terminé"

# ============================================
#  Service systemd
# ============================================
log "Configuration du service systemd..."

NODE_PATH=$(which node)

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=LumiR Media Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=$INSTALL_DIR
ExecStart=$NODE_PATH $INSTALL_DIR/.output/server/index.mjs
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=$PORT
EnvironmentFile=$ENV_FILE

[Install]
WantedBy=multi-user.target
EOF

ok "Service créé ($SERVICE_FILE)"

# Recharger systemd
systemctl daemon-reload

# Activer le service au démarrage
systemctl enable "$SERVICE_NAME" > /dev/null 2>&1
ok "Service activé au démarrage"

# ============================================
#  Démarrage
# ============================================
log "Démarrage du service..."
systemctl start "$SERVICE_NAME"

# Vérifier le statut
sleep 2
if systemctl is-active --quiet "$SERVICE_NAME"; then
  ok "Service $SERVICE_NAME démarré avec succès !"
else
  warn "Le service semble ne pas avoir démarré correctement."
  warn "Vérifiez les logs avec: journalctl -u $SERVICE_NAME -f"
fi

# ============================================
#  Résumé
# ============================================
echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  LumiR installé avec succès !${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "  Version:      ${CYAN}$TAG_NAME${NC}"
echo -e "  Répertoire:   ${CYAN}$INSTALL_DIR${NC}"
echo -e "  Port:         ${CYAN}$PORT${NC}"
echo -e "  Config:       ${CYAN}$ENV_FILE${NC}"
echo -e "  Service:      ${CYAN}$SERVICE_NAME${NC}"
echo ""
echo -e "  ${YELLOW}Commandes utiles:${NC}"
echo -e "    Statut:     sudo systemctl status $SERVICE_NAME"
echo -e "    Logs:       sudo journalctl -u $SERVICE_NAME -f"
echo -e "    Redémarrer: sudo systemctl restart $SERVICE_NAME"
echo -e "    Arrêter:    sudo systemctl stop $SERVICE_NAME"
echo ""
echo -e "  Ouvrez ${CYAN}http://localhost:$PORT${NC} dans votre navigateur"
echo ""
