# syntax=docker/dockerfile:1
# Billetterie — image unique pour les deux services du docker-compose.yml
# (web : next start, cron : daemon node-cron). Cible : Raspberry Pi 5 (ARM64).
#
# Debian slim et PAS alpine : les engines Prisma + musl sur ARM64 sont une
# source d'ennuis connue ; bookworm (openssl 3.0.x) est supporté par Prisma 6.

# ---------------------------------------------------------------------------
# Stage build : dépendances, client Prisma, build Next
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS build
WORKDIR /app

# openssl : sans lui, la détection de plateforme de `prisma generate` retombe
# sur debian-openssl-1.1.x et le client généré est inutilisable au runtime.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

# pnpm via corepack, à la version épinglée dans package.json (packageManager).
# corepack@latest d'abord : la version embarquée dans Node traîne des clés de
# signature périmées pour les pnpm récents.
RUN npm install -g corepack@latest && corepack enable

# Dépendances d'abord (cache Docker). pnpm-workspace.yaml porte la politique
# allowBuilds (engines Prisma autorisés à builder, sharp non).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Code source (filtré par .dockerignore : pas de .env, pas de .db, pas de tests)
COPY . .

# Client Prisma puis build Next. Le build peut prérendre des pages qui lisent
# la base : on lui fournit une base jetable migrée mais vide, et un secret
# factice pour les modules qui exigent SESSION_SECRET à l'import. Variables
# inline (pas ENV) : elles ne servent qu'à cette commande et ne doivent pas
# fuiter dans les métadonnées de l'image.
RUN DATABASE_URL="file:/tmp/build.db" \
    SESSION_SECRET="secret-factice-pour-le-build-uniquement" \
    sh -c 'pnpm exec prisma generate \
        && pnpm exec prisma migrate deploy \
        && pnpm build'

# ---------------------------------------------------------------------------
# Stage runtime
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    COREPACK_HOME=/opt/corepack

# openssl : requis par les engines Prisma ; wget : healthcheck du compose.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl wget \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g corepack@latest && corepack enable \
 && mkdir -p "$COREPACK_HOME" && chown node:node "$COREPACK_HOME"

# node_modules COMPLETS, volontairement : tsx et prisma CLI doivent marcher
# dans le conteneur (cron, migrate deploy, db:seed). Plus lourd
# que l'output standalone de Next, mais simple et robuste.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/lib ./lib
COPY --from=build --chown=node:node /app/config ./config
COPY --from=build --chown=node:node /app/emails ./emails
# tsconfig.json : tsx en a besoin pour résoudre l'alias @/* des scripts.
COPY --from=build --chown=node:node \
  /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml \
  /app/next.config.ts /app/tsconfig.json ./

COPY --chown=node:node docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# La base SQLite vit sur un volume monté en /data (DATABASE_URL=file:/data/prod.db).
# Pas de root au runtime : tout appartient à l'utilisateur node.
RUN mkdir -p /data && chown node:node /data /app

USER node

# Met pnpm en cache dans l'image (sinon corepack le téléchargerait au premier
# démarrage du conteneur — pas de dépendance réseau au boot).
RUN corepack install

EXPOSE 3000

ENTRYPOINT ["entrypoint.sh"]
CMD ["pnpm", "start"]
