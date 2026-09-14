-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Repair" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "unitId" TEXT,
    "supplierId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'REPORTED',
    "reportedByTenantId" TEXT,
    "reportedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "awardedVendorId" TEXT,
    "workOrderSentAt" DATETIME,
    "workOrderRef" TEXT,
    "workApprovedAt" DATETIME,
    "workApprovedBy" TEXT,
    "costApprovedAt" DATETIME,
    "costApprovedBy" TEXT,
    "approvedCost" REAL,
    "finalCost" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Repair_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Repair_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Repair_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Repair_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Repair_reportedByTenantId_fkey" FOREIGN KEY ("reportedByTenantId") REFERENCES "Tenant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Repair_awardedVendorId_fkey" FOREIGN KEY ("awardedVendorId") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Repair" ("approvedCost", "awardedVendorId", "category", "completedAt", "costApprovedAt", "costApprovedBy", "createdAt", "description", "finalCost", "id", "organizationId", "priority", "propertyId", "reportedAt", "status", "supplierId", "title", "unitId", "workApprovedAt", "workApprovedBy", "workOrderRef", "workOrderSentAt") SELECT "approvedCost", "awardedVendorId", "category", "completedAt", "costApprovedAt", "costApprovedBy", "createdAt", "description", "finalCost", "id", "organizationId", "priority", "propertyId", "reportedAt", "status", "supplierId", "title", "unitId", "workApprovedAt", "workApprovedBy", "workOrderRef", "workOrderSentAt" FROM "Repair";
DROP TABLE "Repair";
ALTER TABLE "new_Repair" RENAME TO "Repair";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
