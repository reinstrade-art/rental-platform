-- CreateTable
CREATE TABLE "PlatformSetting" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "commissionPercent" REAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "grossAmount" REAL NOT NULL,
    "commissionAmount" REAL NOT NULL,
    "netAmount" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "conversationId" TEXT,
    "originatorConversationId" TEXT,
    "resultCode" INTEGER,
    "resultDesc" TEXT,
    "mpesaReceiptNumber" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "Payout_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payout_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
    "mpesaAccountType" TEXT,
    "mpesaShortcode" TEXT,
    "mpesaConsumerKey" TEXT,
    "mpesaConsumerSecret" TEXT,
    "mpesaPasskey" TEXT,
    "commissionPercent" REAL,
    "payoutMpesaNumber" TEXT,
    "commissionRouted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Organization" ("approvalChainLength", "brandColor", "createdAt", "id", "leaseTermsTemplate", "letterheadAddress", "letterheadEmail", "letterheadName", "letterheadPhone", "licenseExpiresAt", "licenseFeeKes", "mpesaAccountType", "mpesaConsumerKey", "mpesaConsumerSecret", "mpesaEnv", "mpesaPasskey", "mpesaShortcode", "name", "status", "tier", "trialEndsAt", "updatedAt") SELECT "approvalChainLength", "brandColor", "createdAt", "id", "leaseTermsTemplate", "letterheadAddress", "letterheadEmail", "letterheadName", "letterheadPhone", "licenseExpiresAt", "licenseFeeKes", "mpesaAccountType", "mpesaConsumerKey", "mpesaConsumerSecret", "mpesaEnv", "mpesaPasskey", "mpesaShortcode", "name", "status", "tier", "trialEndsAt", "updatedAt" FROM "Organization";
DROP TABLE "Organization";
ALTER TABLE "new_Organization" RENAME TO "Organization";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Payout_paymentId_key" ON "Payout"("paymentId");

-- CreateIndex
CREATE INDEX "Payout_organizationId_idx" ON "Payout"("organizationId");
