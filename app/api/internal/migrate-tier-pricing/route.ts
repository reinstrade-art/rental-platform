import { NextResponse } from "next/server";
import { getSession, requirePlatformAdmin } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

/**
 * One-time schema migration, run over HTTP for the same reason as
 * migrate-payment-allocations: the production DB connection string is a
 * Vercel Sensitive env var, unreadable outside the deployed runtime.
 * Platform-admin gated, every statement idempotent. Delete once confirmed.
 */
export async function GET() {
  const s = await getSession();
  if (!s || !requirePlatformAdmin(s)) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TierPrice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tier" TEXT NOT NULL,
    "priceKes" REAL NOT NULL,
    "updatedAt" DATETIME NOT NULL
  )`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "TierPrice_tier_key" ON "TierPrice"("tier")`);

  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TierChangeRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "fromTier" TEXT NOT NULL,
    "toTier" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "merchantRequestId" TEXT,
    "checkoutRequestId" TEXT,
    "resultCode" INTEGER,
    "resultDesc" TEXT,
    "mpesaReceiptNumber" TEXT,
    "requestedBy" TEXT NOT NULL,
    "confirmedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" DATETIME,
    CONSTRAINT "TierChangeRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
  )`);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "TierChangeRequest_checkoutRequestId_key" ON "TierChangeRequest"("checkoutRequestId")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "TierChangeRequest_organizationId_idx" ON "TierChangeRequest"("organizationId")`,
  );

  return NextResponse.json({ status: "ok", message: "TierPrice and TierChangeRequest tables are present." });
}
