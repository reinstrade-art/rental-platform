-- CreateTable
CREATE TABLE "CollectionEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "channels" TEXT NOT NULL DEFAULT '',
    "amount" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CollectionEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CollectionEvent_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- AlterTable: plain ADD COLUMNs rather than a table rebuild -- every
-- other table references Organization, so a drop-and-recreate is a needless
-- risk against a live database for eight new columns with defaults.
ALTER TABLE "Organization" ADD COLUMN "collectionsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Organization" ADD COLUMN "collectionsEnabledAt" DATETIME;
ALTER TABLE "Organization" ADD COLUMN "rentDueDay" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "Organization" ADD COLUMN "reminderDaysBefore" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "Organization" ADD COLUMN "graceDays" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "Organization" ADD COLUMN "lateFeeMode" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "Organization" ADD COLUMN "lateFeeValue" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Organization" ADD COLUMN "kraPin" TEXT;

-- CreateIndex
CREATE INDEX "CollectionEvent_organizationId_createdAt_idx" ON "CollectionEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionEvent_leaseId_period_kind_key" ON "CollectionEvent"("leaseId", "period", "kind");
