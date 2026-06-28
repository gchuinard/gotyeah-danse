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
    "childCount" INTEGER NOT NULL DEFAULT 0,
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
INSERT INTO "new_Booking" ("adminNotes", "createdAt", "email", "expiresAt", "freeSeats", "id", "name", "notes", "paidAt", "partySize", "phone", "placedAt", "pmrCompanions", "pmrCount", "publicToken", "refundCents", "refundReason", "remindedAt", "representationId", "status", "ticketMode") SELECT "adminNotes", "createdAt", "email", "expiresAt", "freeSeats", "id", "name", "notes", "paidAt", "partySize", "phone", "placedAt", "pmrCompanions", "pmrCount", "publicToken", "refundCents", "refundReason", "remindedAt", "representationId", "status", "ticketMode" FROM "Booking";
DROP TABLE "Booking";
ALTER TABLE "new_Booking" RENAME TO "Booking";
CREATE UNIQUE INDEX "Booking_publicToken_key" ON "Booking"("publicToken");
CREATE INDEX "Booking_representationId_status_idx" ON "Booking"("representationId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
