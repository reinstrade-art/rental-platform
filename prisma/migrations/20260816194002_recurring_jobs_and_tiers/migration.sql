-- CreateTable
CREATE TABLE "RecurringJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "vendorId" TEXT,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'CLEANING',
    "cost" REAL NOT NULL,
    "frequencyDays" INTEGER NOT NULL DEFAULT 30,
    "nextDueAt" DATETIME NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RecurringJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecurringJob_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecurringJob_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "trialEndsAt" DATETIME,
    "licenseExpiresAt" DATETIME,
    "licenseFeeKes" REAL,
    "tier" TEXT NOT NULL DEFAULT 'BASIC',
    "letterheadName" TEXT,
    "letterheadAddress" TEXT,
    "letterheadPhone" TEXT,
    "letterheadEmail" TEXT,
    "brandColor" TEXT,
    "leaseTermsTemplate" TEXT,
    "approvalChainLength" INTEGER NOT NULL DEFAULT 3,
    "mpesaEnv" TEXT,
    "mpesaShortcode" TEXT,
    "mpesaConsumerKey" TEXT,
    "mpesaConsumerSecret" TEXT,
    "mpesaPasskey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Organization" ("approvalChainLength", "brandColor", "createdAt", "id", "leaseTermsTemplate", "letterheadAddress", "letterheadEmail", "letterheadName", "letterheadPhone", "licenseExpiresAt", "licenseFeeKes", "mpesaConsumerKey", "mpesaConsumerSecret", "mpesaEnv", "mpesaPasskey", "mpesaShortcode", "name", "status", "trialEndsAt", "updatedAt") SELECT "approvalChainLength", "brandColor", "createdAt", "id", "leaseTermsTemplate", "letterheadAddress", "letterheadEmail", "letterheadName", "letterheadPhone", "licenseExpiresAt", "licenseFeeKes", "mpesaConsumerKey", "mpesaConsumerSecret", "mpesaEnv", "mpesaPasskey", "mpesaShortcode", "name", "status", "trialEndsAt", "updatedAt" FROM "Organization";
DROP TABLE "Organization";
ALTER TABLE "new_Organization" RENAME TO "Organization";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "RecurringJob_organizationId_idx" ON "RecurringJob"("organizationId");

-- CreateIndex
CREATE INDEX "RecurringJob_nextDueAt_idx" ON "RecurringJob"("nextDueAt");
