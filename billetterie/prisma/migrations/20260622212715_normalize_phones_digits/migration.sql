-- Téléphone désormais stocké en CHIFFRES bruts ("0612345678"). On normalise
-- l'existant : retrait des espaces (seul séparateur jamais utilisé). Idempotent
-- (les numéros déjà en chiffres ne changent pas).
UPDATE "Booking" SET "phone" = REPLACE("phone", ' ', '') WHERE "phone" LIKE '% %';