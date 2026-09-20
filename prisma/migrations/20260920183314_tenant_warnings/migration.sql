-- CreateTable
CREATE TABLE "TenantWarning" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "grounds" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "period" TEXT,
    "details" TEXT,
    "arrearsAmount" REAL,
    "complyBy" DATETIME NOT NULL,
    "channels" TEXT NOT NULL DEFAULT '',
    "deliveredAt" DATETIME,
    "viewedAt" DATETIME,
    "issuedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TenantWarning_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TenantWarning_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- AlterTable: plain ADD COLUMNs, not a rebuild of Organization (see the
-- collections_automation migration for why).
ALTER TABLE "Organization" ADD COLUMN "arrearsWarningAuto" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Organization" ADD COLUMN "arrearsWarningDay" INTEGER NOT NULL DEFAULT 11;
ALTER TABLE "Organization" ADD COLUMN "warningCureDays" INTEGER NOT NULL DEFAULT 7;

-- CreateIndex
CREATE INDEX "TenantWarning_organizationId_createdAt_idx" ON "TenantWarning"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TenantWarning_leaseId_source_period_key" ON "TenantWarning"("leaseId", "source", "period");
