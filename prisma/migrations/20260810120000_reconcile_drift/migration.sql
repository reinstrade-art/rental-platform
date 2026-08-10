-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "brandColor" TEXT;

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN "paymentCode" TEXT;

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "reference" TEXT,
    "payerName" TEXT,
    "occurredAt" DATETIME NOT NULL,
    "rawPayload" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "matchedLeaseId" TEXT,
    "matchedPaymentId" TEXT,
    "matchedBy" TEXT,
    "matchedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaction_matchedPaymentId_fkey" FOREIGN KEY ("matchedPaymentId") REFERENCES "Payment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "platformAdminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_platformAdminId_fkey" FOREIGN KEY ("platformAdminId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_matchedPaymentId_key" ON "Transaction"("matchedPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_organizationId_paymentCode_key" ON "Unit"("organizationId", "paymentCode");

