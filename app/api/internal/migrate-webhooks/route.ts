import { NextResponse } from "next/server";
import { getSession, requirePlatformAdmin } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

/**
 * One-time schema migration for outbound webhooks — a brand new table, same
 * low-risk shape as ApiKey's migration route. Platform-admin gated,
 * idempotent. Delete once confirmed.
 */
export async function GET() {
  const s = await getSession();
  if (!s || !requirePlatformAdmin(s)) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const results: string[] = [];

  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Webhook" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "organizationId" TEXT NOT NULL,
      "url" TEXT NOT NULL,
      "secret" TEXT NOT NULL,
      "createdBy" TEXT NOT NULL,
      "lastTriggeredAt" DATETIME,
      "lastStatus" INTEGER,
      "disabledAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Webhook_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`);
    results.push("Webhook table created");
  } catch (e) {
    results.push(`Webhook table: ${e instanceof Error ? e.message : "skipped (likely already present)"}`);
  }

  try {
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Webhook_organizationId_idx" ON "Webhook"("organizationId")`);
    results.push("Webhook.organizationId index created");
  } catch (e) {
    results.push(`Webhook.organizationId index: ${e instanceof Error ? e.message : "skipped (likely already present)"}`);
  }

  return NextResponse.json({ status: "ok", results });
}
