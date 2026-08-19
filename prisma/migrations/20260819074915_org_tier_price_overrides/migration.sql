-- CreateTable
CREATE TABLE "OrgTierPrice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "priceKes" REAL NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrgTierPrice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgTierPrice_organizationId_tier_key" ON "OrgTierPrice"("organizationId", "tier");
