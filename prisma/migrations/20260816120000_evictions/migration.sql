-- CreateTable
CREATE TABLE "Eviction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "grounds" TEXT NOT NULL,
    "groundsDetail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NOTICE_DRAFT',
    "noticeServedAt" DATETIME,
    "noticeDeliveryMethod" TEXT,
    "noticeDeadline" DATETIME,
    "distressFiledAt" DATETIME,
    "auctioneerName" TEXT,
    "proclamationEnds" DATETIME,
    "courtFiledAt" DATETIME,
    "courtVenue" TEXT,
    "caseNumber" TEXT,
    "orderObtainedAt" DATETIME,
    "orderVacateBy" DATETIME,
    "enforcedAt" DATETIME,
    "bailiffName" TEXT,
    "policePresent" BOOLEAN NOT NULL DEFAULT false,
    "vacatedAt" DATETIME,
    "withdrawnAt" DATETIME,
    "withdrawnReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Eviction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Eviction_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Eviction_organizationId_idx" ON "Eviction"("organizationId");

-- CreateIndex
CREATE INDEX "Eviction_leaseId_idx" ON "Eviction"("leaseId");

-- CreateIndex
CREATE INDEX "Eviction_status_idx" ON "Eviction"("status");
