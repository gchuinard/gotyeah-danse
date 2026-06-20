-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BuvetteItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "representationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "qtyStock" INTEGER NOT NULL DEFAULT 0,
    "qtySold" INTEGER NOT NULL DEFAULT 0,
    "unitPriceCents" INTEGER NOT NULL DEFAULT 0,
    "purchasePriceCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BuvetteItem_representationId_fkey" FOREIGN KEY ("representationId") REFERENCES "Representation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_BuvetteItem" ("createdAt", "id", "label", "qtySold", "qtyStock", "representationId", "unitPriceCents") SELECT "createdAt", "id", "label", "qtySold", "qtyStock", "representationId", "unitPriceCents" FROM "BuvetteItem";
DROP TABLE "BuvetteItem";
ALTER TABLE "new_BuvetteItem" RENAME TO "BuvetteItem";
CREATE INDEX "BuvetteItem_representationId_idx" ON "BuvetteItem"("representationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
