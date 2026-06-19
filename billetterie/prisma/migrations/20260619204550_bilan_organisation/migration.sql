-- AlterTable
ALTER TABLE "Representation" ADD COLUMN "orgNotes" TEXT;
ALTER TABLE "Representation" ADD COLUMN "weather" TEXT;

-- CreateTable
CREATE TABLE "BuvetteItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "representationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "qtyStock" INTEGER NOT NULL DEFAULT 0,
    "qtySold" INTEGER NOT NULL DEFAULT 0,
    "unitPriceCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BuvetteItem_representationId_fkey" FOREIGN KEY ("representationId") REFERENCES "Representation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BuvetteItem_representationId_idx" ON "BuvetteItem"("representationId");
