import { NextResponse } from "next/server";
import { getSession, requirePlatformAdmin } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

/**
 * One-time schema migration, run over HTTP for the same reason as the other
 * migrate-* routes: the production DB connection string is a Vercel
 * Sensitive env var, unreadable outside the deployed runtime.
 *
 * Deployed deliberately BEFORE any of this lands in schema.prisma — the
 * caretaker-role deploy shipped a new User column ahead of this same
 * migration and broke login for everyone, since Organization is included
 * even more widely than User (getSession's own license check reads it on
 * every request). This route adds the columns to the live table first, and
 * only once confirmed does app code start selecting them. Platform-admin
 * gated, every statement idempotent-safe to re-run. Delete once confirmed.
 */
export async function GET() {
  const s = await getSession();
  if (!s || !requirePlatformAdmin(s)) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const results: string[] = [];

  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Organization" ADD COLUMN "commissionPercent" REAL`);
    results.push("Organization.commissionPercent added");
  } catch (e) {
    results.push(`Organization.commissionPercent: ${e instanceof Error ? e.message : "skipped (likely already present)"}`);
  }

  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Organization" ADD COLUMN "payoutMpesaNumber" TEXT`);
    results.push("Organization.payoutMpesaNumber added");
  } catch (e) {
    results.push(`Organization.payoutMpesaNumber: ${e instanceof Error ? e.message : "skipped (likely already present)"}`);
  }

  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Organization" ADD COLUMN "commissionRouted" BOOLEAN NOT NULL DEFAULT false`);
    results.push("Organization.commissionRouted added");
  } catch (e) {
    results.push(`Organization.commissionRouted: ${e instanceof Error ? e.message : "skipped (likely already present)"}`);
  }

  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "PlatformSetting" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "commissionPercent" REAL NOT NULL DEFAULT 0,
      "updatedAt" DATETIME NOT NULL
    )`);
    results.push("PlatformSetting table created");
  } catch (e) {
    results.push(`PlatformSetting table: ${e instanceof Error ? e.message : "skipped (likely already present)"}`);
  }

  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Payout" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "organizationId" TEXT NOT NULL,
      "paymentId" TEXT NOT NULL,
      "grossAmount" REAL NOT NULL,
      "commissionAmount" REAL NOT NULL,
      "netAmount" REAL NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'PENDING',
      "conversationId" TEXT,
      "originatorConversationId" TEXT,
      "resultCode" INTEGER,
      "resultDesc" TEXT,
      "mpesaReceiptNumber" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "completedAt" DATETIME,
      CONSTRAINT "Payout_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT "Payout_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )`);
    results.push("Payout table created");
  } catch (e) {
    results.push(`Payout table: ${e instanceof Error ? e.message : "skipped (likely already present)"}`);
  }

  try {
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Payout_paymentId_key" ON "Payout"("paymentId")`);
    results.push("Payout.paymentId unique index created");
  } catch (e) {
    results.push(`Payout.paymentId index: ${e instanceof Error ? e.message : "skipped (likely already present)"}`);
  }

  try {
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Payout_organizationId_idx" ON "Payout"("organizationId")`);
    results.push("Payout.organizationId index created");
  } catch (e) {
    results.push(`Payout.organizationId index: ${e instanceof Error ? e.message : "skipped (likely already present)"}`);
  }

  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PlatformSetting" ("id", "commissionPercent", "updatedAt") VALUES ('default', 0, CURRENT_TIMESTAMP)`,
    );
    results.push("PlatformSetting default row inserted");
  } catch (e) {
    results.push(`PlatformSetting default row: ${e instanceof Error ? e.message : "skipped (likely already present)"}`);
  }

  return NextResponse.json({ status: "ok", results });
}
