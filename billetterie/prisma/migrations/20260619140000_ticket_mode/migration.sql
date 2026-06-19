-- Mode de remise des billets, choisi par l'admin : "email" (e-billet par email
-- avec QR) ou "papier" (remis en main, l'admin imprime — pas d'envoi auto).
-- Défaut "email" = comportement actuel pour les demandes existantes.
ALTER TABLE "Booking" ADD COLUMN "ticketMode" TEXT NOT NULL DEFAULT 'email';
