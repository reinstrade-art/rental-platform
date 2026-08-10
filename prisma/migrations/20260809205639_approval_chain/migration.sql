-- AlterTable
ALTER TABLE "User" ADD COLUMN "approvalLevel" TEXT;

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "payload" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "raisedById" TEXT NOT NULL,
    "raisedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "ApprovalRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ApprovalRequest_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApprovalStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "signedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApprovalStep_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ApprovalStep_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "letterheadName" TEXT,
    "letterheadAddress" TEXT,
    "letterheadPhone" TEXT,
    "letterheadEmail" TEXT,
    "approvalChainLength" INTEGER NOT NULL DEFAULT 3,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Organization" ("createdAt", "id", "letterheadAddress", "letterheadEmail", "letterheadName", "letterheadPhone", "name", "status", "updatedAt") SELECT "createdAt", "id", "letterheadAddress", "letterheadEmail", "letterheadName", "letterheadPhone", "name", "status", "updatedAt" FROM "Organization";
DROP TABLE "Organization";
ALTER TABLE "new_Organization" RENAME TO "Organization";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_organizationId_kind_subjectId_status_key" ON "ApprovalRequest"("organizationId", "kind", "subjectId", "status");
