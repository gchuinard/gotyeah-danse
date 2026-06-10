#!/bin/sh
# Entrée commune des services web et cron : applique les migrations Prisma
# (idempotent — ne fait rien si la base est à jour) puis exécute la commande
# du service. La base SQLite vit sur le volume monté en /data.
set -e

echo "[entrypoint] prisma migrate deploy"
./node_modules/.bin/prisma migrate deploy

exec "$@"
