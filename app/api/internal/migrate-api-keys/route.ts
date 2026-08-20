import { NextResponse } from "next/server";
import { getSession, requirePlatformAdmin } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

/**
 * One-time schema migration for the org-facing REST API — a brand new table
 * nothing existing code touches, so (unlike Organization/User) this carries
 * no site-wide crash risk even if skipped; still deployed ahead of the
 * feature code for consistency with the other migrate-* routes.
 * Platform-admin gated, idempotent. Delete once confirmed.
 */
export async function GET() {
  const s = await getSession();
  if (!s || !requirePlatformAdmin(s)) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const results: string[] = [];

  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ApiKey" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "organizationId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "keyHash" TEXT NOT NULL,
      "keyPrefix" TEXT NOT NULL,
      "createdBy" TEXT NOT NULL,
      "lastUsedAt" DATETIME,
      "revokedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ApiKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`);
    results.push("ApiKey table created");
  } catch (e) {
    results.push(`ApiKey table: ${e instanceof Error ? e.message : "skipped (likely already present)"}`);
  }

  try {
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "ApiKey_keyHash_key" ON "ApiKey"("keyHash")`);
    results.push("ApiKey.keyHash unique index created");
  } catch (e) {
    results.push(`ApiKey.keyHash index: ${e instanceof Error ? e.message : "skipped (likely already present)"}`);
  }

  try {
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ApiKey_organizationId_idx" ON "ApiKey"("organizationId")`);
    results.push("ApiKey.organizationId index created");
  } catch (e) {
    results.push(`ApiKey.organizationId index: ${e instanceof Error ? e.message : "skipped (likely already present)"}`);
  }

  return NextResponse.json({ status: "ok", results });
}
