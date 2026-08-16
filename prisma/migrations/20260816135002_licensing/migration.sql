-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "licenseExpiresAt" DATETIME;
ALTER TABLE "Organization" ADD COLUMN "licenseFeeKes" REAL;
ALTER TABLE "Organization" ADD COLUMN "trialEndsAt" DATETIME;

-- CreateTable
CREATE TABLE "LicensePayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "periodDays" INTEGER NOT NULL DEFAULT 30,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "merchantRequestId" TEXT,
    "checkoutRequestId" TEXT,
    "resultCode" INTEGER,
    "resultDesc" TEXT,
    "mpesaReceiptNumber" TEXT,
    "recordedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LicensePayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "LicensePayment_checkoutRequestId_key" ON "LicensePayment"("checkoutRequestId");

-- CreateIndex
CREATE INDEX "LicensePayment_organizationId_idx" ON "LicensePayment"("organizationId");
