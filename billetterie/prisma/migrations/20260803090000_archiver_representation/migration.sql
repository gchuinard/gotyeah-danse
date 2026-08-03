-- Archivage (« clôture ») d'une représentation, réversible : archivedAt null =
-- représentation active. Une rep archivée disparaît du quotidien (demandes,
-- tableau de bord, sélecteurs plan/scan, formulaire public) et ses demandes sont
-- gelées — rien n'est supprimé (stats, historique et export CSV la lisent
-- toujours). archivedBy = email du super-admin auteur, pour l'audit.
-- Colonnes NULLABLES : tout l'existant reste actif, aucun backfill.
ALTER TABLE "Representation" ADD COLUMN "archivedAt" DATETIME;
ALTER TABLE "Representation" ADD COLUMN "archivedBy" TEXT;
