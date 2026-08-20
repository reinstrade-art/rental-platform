import { NextResponse } from "next/server";
import { getSession, requirePlatformAdmin } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

/**
 * One-time schema migration for the QuickBooks/Xero connection — two brand
 * new tables, same low-risk shape as ApiKey/Webhook's migration routes.
 * Platform-admin gated, idempotent. Delete once confirmed.
 */
export async function GET() {
  const s = await getSession();
  if (!s || !requirePlatformAdmin(s)) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const results: string[] = [];

  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AccountingConnection" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "organizationId" TEXT NOT NULL,
      "provider" TEXT NOT NULL,
      "accessToken" TEXT NOT NULL,
      "refreshToken" TEXT NOT NULL,
      "expiresAt" DATETIME NOT NULL,
      "realmId" TEXT NOT NULL,
      "incomeAccountId" TEXT,
      "bankAccountId" TEXT,
      "connectedBy" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "AccountingConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`);
    results.push("AccountingConnection table created");
  } catch (e) {
    results.push(`AccountingConnection table: ${e instanceof Error ? e.message : "skipped (likely already present)"}`);
  }

  try {
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "AccountingConnection_organizationId_provider_key" ON "AccountingConnection"("organizationId", "provider")`,
    );
    results.push("AccountingConnection unique index created");
  } catch (e) {
    results.push(`AccountingConnection index: ${e instanceof Error ? e.message : "skipped (likely already present)"}`);
  }

  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AccountingSyncLog" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "organizationId" TEXT NOT NULL,
      "paymentId" TEXT NOT NULL,
      "provider" TEXT NOT NULL,
      "externalId" TEXT,
      "status" TEXT NOT NULL DEFAULT 'PENDING',
      "error" TEXT,
      "syncedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "AccountingSyncLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "AccountingSyncLog_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`);
    results.push("AccountingSyncLog table created");
  } catch (e) {
    results.push(`AccountingSyncLog table: ${e instanceof Error ? e.message : "skipped (likely already present)"}`);
  }

  try {
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "AccountingSyncLog_paymentId_provider_key" ON "AccountingSyncLog"("paymentId", "provider")`,
    );
    results.push("AccountingSyncLog unique index created");
  } catch (e) {
    results.push(`AccountingSyncLog index: ${e instanceof Error ? e.message : "skipped (likely already present)"}`);
  }

  return NextResponse.json({ status: "ok", results });
}
