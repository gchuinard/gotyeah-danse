#!/bin/sh
# Sauvegarde quotidienne de la base de production, avec rotation.
#
# POURQUOI SUR L'HÔTE et pas dans le service `cron` applicatif : celui-ci ne
# monte que le volume `billetterie-data` — ses sauvegardes atterriraient sur le
# volume MÊME qu'elles protègent — et il n'a pas accès à `docker compose`.
#
# SNAPSHOT COHÉRENT : `VACUUM INTO` (SQLite >= 3.27) écrit une copie propre même
# si une écriture est en cours, là où un `cp` à chaud peut attraper une
# transaction à moitié écrite. Repli sur `docker compose cp` si VACUUM échoue —
# mieux vaut une sauvegarde imparfaite que pas de sauvegarde du tout.
#
# ROTATION : garde les N dernières quotidiennes (14 par défaut) ET, sans limite
# de durée, celles du 1er du mois. Ne touche QUE ses propres fichiers
# `prod-*.db.gz` : les sauvegardes manuelles (`backup-*.db.gz`) sont hors de
# portée du script, par construction.
#
# Usage :
#   ./scripts/backup-prod.sh                    # depuis billetterie/
#   BACKUP_KEEP_DAYS=30 ./scripts/backup-prod.sh
# Le script se replace seul dans son dossier : le cron peut l'appeler en absolu.
#
# Restauration :
#   gunzip -c /home/pi/sauvegardes-billetterie/prod-AAAA-MM-JJ.db.gz > /tmp/restore.db
#   docker compose cp /tmp/restore.db web:/data/prod.db && docker compose restart web

set -eu

# Le cron a un PATH minimal : on garantit l'accès à docker.
export PATH="/usr/local/bin:/usr/bin:/bin:${PATH:-}"

DEST="${BACKUP_DEST:-/home/pi/sauvegardes-billetterie}"
GARDE_JOURS="${BACKUP_KEEP_DAYS:-14}"
TMP_CONTENEUR=/data/.backup-tmp.db

cd "$(dirname "$0")/.." # → billetterie/ (racine du projet compose)

JOUR=$(date +%F)
CIBLE="$DEST/prod-$JOUR.db"
mkdir -p "$DEST"

# 1. Snapshot dans le conteneur, puis extraction vers l'hôte.
docker compose exec -T web rm -f "$TMP_CONTENEUR" 2>/dev/null || true
if docker compose exec -T web node -e "
  const { PrismaClient } = require('@prisma/client')
  const p = new PrismaClient()
  p.\$executeRawUnsafe(\"VACUUM INTO '$TMP_CONTENEUR'\")
    .then(() => process.exit(0))
    .catch((e) => { console.error(e.message); process.exit(1) })
" >/dev/null 2>&1; then
  docker compose cp "web:$TMP_CONTENEUR" "$CIBLE" >/dev/null
  docker compose exec -T web rm -f "$TMP_CONTENEUR" 2>/dev/null || true
  METHODE="VACUUM INTO"
else
  docker compose cp web:/data/prod.db "$CIBLE" >/dev/null
  METHODE="copie à chaud (repli — VACUUM a échoué)"
fi

# 2. Contrôle : fichier non vide ET réellement une base SQLite. Une sauvegarde
# non vérifiée n'est pas une sauvegarde.
if [ ! -s "$CIBLE" ] || [ "$(head -c 15 "$CIBLE")" != "SQLite format 3" ]; then
  echo "[backup] ÉCHEC : $CIBLE n'est pas une base SQLite valide" >&2
  rm -f "$CIBLE"
  exit 1
fi

gzip -9 -f "$CIBLE"
echo "[backup] $JOUR — $(du -h "$CIBLE.gz" | cut -f1) — $METHODE"

# 3. Rotation. Le filtre `! -name 'prod-*-01.db.gz'` épargne les 1ers du mois
# (archive mensuelle conservée sans limite) ; le motif `prod-*` épargne les
# sauvegardes manuelles.
find "$DEST" -maxdepth 1 -name 'prod-*.db.gz' ! -name 'prod-*-01.db.gz' \
  -mtime "+$GARDE_JOURS" -print -delete |
  sed 's|^|[backup] purgée : |'
