-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN "propertyId" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "tenantId" TEXT,
    "vendorId" TEXT,
    "propertyId" TEXT,
    "approvalLevel" TEXT,
    "disabledAt" DATETIME,
    "consentedAt" DATETIME,
    "consentVersion" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("approvalLevel", "consentVersion", "consentedAt", "createdAt", "disabledAt", "email", "id", "organizationId", "passwordHash", "phone", "role", "tenantId", "vendorId") SELECT "approvalLevel", "consentVersion", "consentedAt", "createdAt", "disabledAt", "email", "id", "organizationId", "passwordHash", "phone", "role", "tenantId", "vendorId" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
CREATE UNIQUE INDEX "User_tenantId_key" ON "User"("tenantId");
CREATE UNIQUE INDEX "User_vendorId_key" ON "User"("vendorId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
