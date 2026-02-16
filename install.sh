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
  echo "Usage: sudo bash install.sh --repo <owner/repo> [options]"
  echo ""
  echo "Options:"
  echo "  --repo      GitHub repository (ex: Athenox14/LumiR)       [requis]"
  echo "  --token     GitHub token (pour les repos privés)            [optionnel]"
  echo "  --port      Port de l'application (défaut: 3000)            [optionnel]"
  echo "  --smb       Partage SMB (ex: //192.168.1.100/Films)         [optionnel]"
  echo "  --smb-user  Utilisateur SMB                                 [optionnel]"
  echo "  --smb-pass  Mot de passe SMB                                [optionnel]"
  echo "  --smb-mount Point de montage (défaut: /mnt/lumir-media)     [optionnel]"
  echo "  --help      Afficher cette aide"
  echo ""
  exit 1
}

# ============================================
#  Parse arguments
# ============================================
REPO=""
TOKEN=""
PORT=3000
SMB_SHARE=""
SMB_USER=""
SMB_PASS=""
SMB_MOUNT="/mnt/lumir-media"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)      REPO="$2"; shift 2 ;;
    --token)     TOKEN="$2"; shift 2 ;;
    --port)      PORT="$2"; shift 2 ;;
    --smb)       SMB_SHARE="$2"; shift 2 ;;
    --smb-user)  SMB_USER="$2"; shift 2 ;;
    --smb-pass)  SMB_PASS="$2"; shift 2 ;;
    --smb-mount) SMB_MOUNT="$2"; shift 2 ;;
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
#  Montage SMB (optionnel)
# ============================================
if [ -n "$SMB_SHARE" ]; then
  log "Configuration du partage SMB..."

  # Installer cifs-utils si nécessaire
  if ! dpkg -s cifs-utils &> /dev/null; then
    log "Installation de cifs-utils..."
    apt-get update -qq && apt-get install -y -qq cifs-utils > /dev/null 2>&1
    ok "cifs-utils installé"
  else
    ok "cifs-utils disponible"
  fi

  # Créer le point de montage
  mkdir -p "$SMB_MOUNT"

  # Créer le fichier de credentials (plus sûr que dans fstab)
  SMB_CRED_FILE="/etc/lumir-smb-credentials"
  if [ -n "$SMB_USER" ]; then
    cat > "$SMB_CRED_FILE" <<CREDEOF
username=$SMB_USER
password=$SMB_PASS
CREDEOF
    chmod 600 "$SMB_CRED_FILE"
    ok "Fichier de credentials créé ($SMB_CRED_FILE)"
    MOUNT_OPTS="credentials=$SMB_CRED_FILE,uid=www-data,gid=www-data,iocharset=utf8,vers=3.0,_netdev,nofail"
  else
    MOUNT_OPTS="guest,uid=www-data,gid=www-data,iocharset=utf8,vers=3.0,_netdev,nofail"
  fi

  # Ajouter à fstab si pas déjà présent
  FSTAB_ENTRY="$SMB_SHARE  $SMB_MOUNT  cifs  $MOUNT_OPTS  0  0"
  if ! grep -qF "$SMB_SHARE" /etc/fstab; then
    echo "" >> /etc/fstab
    echo "# LumiR - Partage média SMB" >> /etc/fstab
    echo "$FSTAB_ENTRY" >> /etc/fstab
    ok "Entrée fstab ajoutée"
  else
    warn "Une entrée fstab pour $SMB_SHARE existe déjà, ignorée"
  fi

  # Monter maintenant
  if mountpoint -q "$SMB_MOUNT"; then
    ok "Partage déjà monté sur $SMB_MOUNT"
  else
    log "Montage de $SMB_SHARE sur $SMB_MOUNT..."
    if mount "$SMB_MOUNT"; then
      ok "Partage SMB monté sur $SMB_MOUNT"
    else
      warn "Impossible de monter le partage SMB. Vérifiez les paramètres."
      warn "Vous pourrez monter manuellement avec: sudo mount $SMB_MOUNT"
    fi
  fi

  # Vérifier l'accès
  if [ -d "$SMB_MOUNT" ] && mountpoint -q "$SMB_MOUNT"; then
    FILE_COUNT=$(ls -1 "$SMB_MOUNT" 2>/dev/null | wc -l)
    ok "Partage accessible ($FILE_COUNT éléments trouvés)"
  fi
fi

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

# Extraire les infos avec python3 (fiable pour parser le JSON)
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

ok "Version trouvée: $RELEASE_NAME ($TAG_NAME)"

# ============================================
#  Téléchargement
# ============================================
TMP_DIR=$(mktemp -d)
ZIP_PATH="$TMP_DIR/lumir.zip"

log "Téléchargement en cours..."

# Pour les repos privés, utiliser l'URL API de l'asset avec Accept: octet-stream
# Pour les repos publics, browser_download_url suffit
if [ -n "$TOKEN" ] && [ -n "$ASSET_API_URL" ]; then
  ACTUAL_URL="$ASSET_API_URL"
  log "Téléchargement via API (repo privé): $ASSET_API_URL"
  curl -L -sS \
    -H "Accept: application/octet-stream" \
    -H "User-Agent: LumiR-Installer" \
    -H "Authorization: Bearer $TOKEN" \
    -o "$ZIP_PATH" "$ACTUAL_URL"
else
  ACTUAL_URL="$DOWNLOAD_URL"
  log "Téléchargement direct: $DOWNLOAD_URL"
  curl -L -sS \
    -H "User-Agent: LumiR-Installer" \
    -o "$ZIP_PATH" "$ACTUAL_URL"
fi

if [ ! -f "$ZIP_PATH" ]; then
  fail "Échec du téléchargement"
fi

ZIP_SIZE=$(du -h "$ZIP_PATH" | cut -f1)

# Vérifier que c'est bien un zip (pas une page HTML d'erreur)
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
  cat > "$ENV_FILE" <<ENVEOF
PORT=$PORT
NODE_ENV=production
HOST=0.0.0.0
NUXT_HOST=0.0.0.0
ENVEOF
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

# Dépendances systemd : ajouter remote-fs si SMB configuré
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

ok "Service créé ($SERVICE_FILE)"

# Recharger systemd
systemctl daemon-reload

# Activer le service au démarrage
systemctl enable "$SERVICE_NAME" > /dev/null 2>&1
ok "Service activé au démarrage"

# ============================================
#  Pare-feu (ouvrir le port)
# ============================================
if command -v ufw &> /dev/null; then
  if ufw status | grep -q "active"; then
    log "Ouverture du port $PORT dans le pare-feu..."
    ufw allow "$PORT/tcp" > /dev/null 2>&1
    ok "Port $PORT ouvert (ufw)"
  fi
fi

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
if [ -n "$SMB_SHARE" ]; then
echo -e "  Partage SMB:  ${CYAN}$SMB_SHARE${NC} → ${CYAN}$SMB_MOUNT${NC}"
fi
echo ""
echo -e "  ${YELLOW}Commandes utiles:${NC}"
echo -e "    Statut:     sudo systemctl status $SERVICE_NAME"
echo -e "    Logs:       sudo journalctl -u $SERVICE_NAME -f"
echo -e "    Redémarrer: sudo systemctl restart $SERVICE_NAME"
echo -e "    Arrêter:    sudo systemctl stop $SERVICE_NAME"
echo ""
SERVER_IP=$(hostname -I | awk '{print $1}')
echo -e "  Ouvrez ${CYAN}http://$SERVER_IP:$PORT${NC} dans votre navigateur"
echo -e "  (ou ${CYAN}http://localhost:$PORT${NC} en local)"
echo ""
