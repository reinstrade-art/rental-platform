-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trade" TEXT,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "prequalified" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Vendor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Repair" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "unitId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'REPORTED',
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
    CONSTRAINT "Repair_awardedVendorId_fkey" FOREIGN KEY ("awardedVendorId") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "repairId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Quote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Quote_repairId_fkey" FOREIGN KEY ("repairId") REFERENCES "Repair" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Quote_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Quote_repairId_vendorId_key" ON "Quote"("repairId", "vendorId");
