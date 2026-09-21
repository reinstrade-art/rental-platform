-- CreateTable
CREATE TABLE "MeterReading" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "reading" REAL NOT NULL,
    "previous" REAL NOT NULL,
    "opening" REAL,
    "consumption" REAL NOT NULL,
    "rate" REAL NOT NULL,
    "amount" REAL NOT NULL,
    "chargeId" TEXT,
    "readAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MeterReading_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MeterReading_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MeterReading_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- AlterTable: plain ADD COLUMNs rather than a rebuild of Property.
ALTER TABLE "Property" ADD COLUMN "waterRate" REAL;
ALTER TABLE "Property" ADD COLUMN "waterMinCharge" REAL NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "MeterReading_chargeId_key" ON "MeterReading"("chargeId");

-- CreateIndex
CREATE INDEX "MeterReading_organizationId_period_idx" ON "MeterReading"("organizationId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "MeterReading_unitId_period_key" ON "MeterReading"("unitId", "period");
