import { NextResponse } from "next/server";
import { getSession, requirePlatformAdmin } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

/**
 * One-time schema migration for message attachments — a brand new table,
 * same low-risk shape as the other recent migrate-* routes (ApiKey,
 * Webhook, AccountingConnection). Platform-admin gated, idempotent.
 * Delete once confirmed.
 */
export async function GET() {
  const s = await getSession();
  if (!s || !requirePlatformAdmin(s)) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const results: string[] = [];

  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "MessageAttachment" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "organizationId" TEXT NOT NULL,
      "messageId" TEXT NOT NULL,
      "pathname" TEXT NOT NULL,
      "filename" TEXT NOT NULL,
      "mimeType" TEXT NOT NULL,
      "size" INTEGER NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "MessageAttachment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`);
    results.push("MessageAttachment table created");
  } catch (e) {
    results.push(`MessageAttachment table: ${e instanceof Error ? e.message : "skipped (likely already present)"}`);
  }

  try {
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MessageAttachment_messageId_idx" ON "MessageAttachment"("messageId")`);
    results.push("MessageAttachment.messageId index created");
  } catch (e) {
    results.push(`MessageAttachment.messageId index: ${e instanceof Error ? e.message : "skipped (likely already present)"}`);
  }

  return NextResponse.json({ status: "ok", results });
}
