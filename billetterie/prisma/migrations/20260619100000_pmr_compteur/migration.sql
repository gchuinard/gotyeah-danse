-- Remplace le booléen `pmr` par un compteur `pmrCount` (nombre de personnes à
-- mobilité réduite dans la demande) — permet de gérer plusieurs PMR sur une
-- même commande.
--
-- Données préservées : une demande PMR existante (pmr = true) devient
-- pmrCount = 1 ; une demande non PMR reste pmrCount = 0.
ALTER TABLE "Booking" ADD COLUMN "pmrCount" INTEGER NOT NULL DEFAULT 0;
UPDATE "Booking" SET "pmrCount" = 1 WHERE "pmr" = true;
ALTER TABLE "Booking" DROP COLUMN "pmr";
