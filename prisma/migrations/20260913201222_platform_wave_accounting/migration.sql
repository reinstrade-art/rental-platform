-- CreateTable
CREATE TABLE "PlatformAccountingConnection" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "provider" TEXT NOT NULL DEFAULT 'WAVE',
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "businessId" TEXT NOT NULL,
    "incomeAccountId" TEXT,
    "expenseAccountId" TEXT,
    "bankAccountId" TEXT,
    "connectedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PlatformAccountingSyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "licensePaymentId" TEXT,
    "payoutId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'WAVE',
    "externalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "syncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformAccountingSyncLog_licensePaymentId_fkey" FOREIGN KEY ("licensePaymentId") REFERENCES "LicensePayment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlatformAccountingSyncLog_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAccountingSyncLog_licensePaymentId_key" ON "PlatformAccountingSyncLog"("licensePaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAccountingSyncLog_payoutId_key" ON "PlatformAccountingSyncLog"("payoutId");
