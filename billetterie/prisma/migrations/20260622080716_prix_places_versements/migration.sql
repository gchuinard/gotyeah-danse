/*
  Warnings:

  - You are about to drop the column `amountCents` on the `Booking` table. All the data in the column will be lost.
  - You are about to drop the column `paymentMethod` on the `Booking` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "depositOn" DATETIME,
    "reference" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Backfill : recopier chaque règlement existant (Booking.amountCents) en UN
-- versement, AVANT que la table Booking soit reconstruite sans ces colonnes.
-- id = hex aléatoire (unique) ; méthode reprise (défaut 'autre') ; date = paidAt.
-- On ignore les montants nuls/absents (« payé sans montant » → aucun versement).
-- On se limite aux statuts qui comptaient déjà en caisse (paid/placed) : une
-- demande annulée/expirée gardait son amountCents (jamais effacé à l'annulation)
-- sans être comptée — recréer un versement la réinjecterait à tort dans la caisse.
INSERT INTO "Payment" ("id", "bookingId", "method", "amountCents", "depositOn", "reference", "note", "createdAt")
SELECT
    lower(hex(randomblob(16))),
    "id",
    COALESCE("paymentMethod", 'autre'),
    "amountCents",
    NULL,
    NULL,
    NULL,
    COALESCE("paidAt", "createdAt", CURRENT_TIMESTAMP)
FROM "Booking"
WHERE "amountCents" IS NOT NULL AND "amountCents" > 0
  AND "status" IN ('paid', 'placed');

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Booking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "representationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "partySize" INTEGER NOT NULL,
    "notes" TEXT,
    "pmrCount" INTEGER NOT NULL DEFAULT 0,
    "pmrCompanions" INTEGER NOT NULL DEFAULT 0,
    "adminNotes" TEXT,
    "ticketMode" TEXT NOT NULL DEFAULT 'email',
    "status" TEXT NOT NULL,
    "publicToken" TEXT NOT NULL,
    "freeSeats" INTEGER NOT NULL DEFAULT 0,
    "refundCents" INTEGER,
    "refundReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" DATETIME,
    "placedAt" DATETIME,
    "expiresAt" DATETIME,
    "remindedAt" DATETIME,
    CONSTRAINT "Booking_representationId_fkey" FOREIGN KEY ("representationId") REFERENCES "Representation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Booking" ("adminNotes", "createdAt", "email", "expiresAt", "id", "name", "notes", "paidAt", "partySize", "phone", "placedAt", "pmrCompanions", "pmrCount", "publicToken", "refundCents", "refundReason", "remindedAt", "representationId", "status", "ticketMode") SELECT "adminNotes", "createdAt", "email", "expiresAt", "id", "name", "notes", "paidAt", "partySize", "phone", "placedAt", "pmrCompanions", "pmrCount", "publicToken", "refundCents", "refundReason", "remindedAt", "representationId", "status", "ticketMode" FROM "Booking";
DROP TABLE "Booking";
ALTER TABLE "new_Booking" RENAME TO "Booking";
CREATE UNIQUE INDEX "Booking_publicToken_key" ON "Booking"("publicToken");
CREATE INDEX "Booking_representationId_status_idx" ON "Booking"("representationId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Payment_bookingId_idx" ON "Payment"("bookingId");
