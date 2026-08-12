-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "mpesaConsumerKey" TEXT;
ALTER TABLE "Organization" ADD COLUMN "mpesaConsumerSecret" TEXT;
ALTER TABLE "Organization" ADD COLUMN "mpesaEnv" TEXT;
ALTER TABLE "Organization" ADD COLUMN "mpesaPasskey" TEXT;
ALTER TABLE "Organization" ADD COLUMN "mpesaShortcode" TEXT;

-- CreateTable
CREATE TABLE "MpesaRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "merchantRequestId" TEXT,
    "checkoutRequestId" TEXT,
    "resultCode" INTEGER,
    "resultDesc" TEXT,
    "mpesaReceiptNumber" TEXT,
    "initiatedBy" TEXT NOT NULL,
    "paymentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MpesaRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MpesaRequest_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MpesaRequest_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MpesaRequest_checkoutRequestId_key" ON "MpesaRequest"("checkoutRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "MpesaRequest_paymentId_key" ON "MpesaRequest"("paymentId");

