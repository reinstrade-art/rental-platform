-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "tenantId" TEXT,
    "vendorId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "code" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

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
    "approvalLevel" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("approvalLevel", "createdAt", "email", "id", "organizationId", "passwordHash", "phone", "role", "tenantId") SELECT "approvalLevel", "createdAt", "email", "id", "organizationId", "passwordHash", "phone", "role", "tenantId" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
CREATE UNIQUE INDEX "User_tenantId_key" ON "User"("tenantId");
CREATE UNIQUE INDEX "User_vendorId_key" ON "User"("vendorId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_code_key" ON "Invitation"("code");
