# Image LumiR pour un deploiement conteneurise (template OxaDash).
#
# Le depot vise historiquement une installation systemd (install.sh) : Node 18+,
# `node .output/server/index.mjs`, port 3000, NUXT_HOST=0.0.0.0. On reproduit
# exactement ce modele d'execution, rien de plus.
#
# Deux dependances natives imposent de construire ET d'executer sur la meme
# base : better-sqlite3 (module compile) et ffmpeg-static (binaire telecharge a
# l'installation). D'ou une image finale Debian slim identique a celle de build,
# et non une Alpine.
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Les scripts d'installation ont besoin du depot complet : `postinstall` lance
# `patch-package` (qui lit patches/) puis `nuxt prepare`. Copier seulement les
# manifestes ferait echouer l'etape.
COPY . .
RUN npm ci && npm run build

FROM node:22-bookworm-slim
WORKDIR /app

ENV NODE_ENV=production \
    NUXT_HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/lumir.db

# ffmpeg/ffprobe : PAS fournis par ffmpeg-static dans .output. Nitro (node-file-trace)
# ne suit pas le binaire telecharge par le postinstall d'ffmpeg-static (chemin
# resolu dynamiquement, hors de son analyse statique) : l'image finale ne
# contenait AUCUN binaire ffmpeg (verifie en prod, `find / -iname ffmpeg*` vide),
# donc mediaEngine.ts echouait a chaque probe/lecture — ecran noir silencieux.
# Paquet apt : source fiable, et mediaEngine.resolveBinary() retombe deja sur
# `which ffmpeg`/`which ffprobe` en l'absence d'ffmpeg-static.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# `.output` embarque les dependances tracees par Nitro, y compris le .node de
# better-sqlite3.
COPY --from=build /app/.output ./.output

# /data : base SQLite. /media : bibliotheque de films, montee par l'hote ou par
# l'orchestrateur — jamais dans l'image.
RUN mkdir -p /data /media
VOLUME ["/data", "/media"]

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
