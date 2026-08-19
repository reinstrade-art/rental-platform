import { NextResponse } from "next/server";
import { getSession, requirePlatformAdmin } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

/**
 * One-time schema migration, run over HTTP for the same reason as the other
 * migrate-* routes: the production DB connection string is a Vercel
 * Sensitive env var, unreadable outside the deployed runtime. Adds the two
 * plain columns the caretaker role needs — no rebuild-the-table dance,
 * since SQLite allows ADD COLUMN for a simple nullable column fine; Prisma's
 * own migration only rebuilds User because it also wants the FK declared
 * at the DB level, which isn't required for the app to function correctly.
 * Platform-admin gated, every statement idempotent-safe to re-run. Delete
 * once confirmed.
 */
export async function GET() {
  const s = await getSession();
  if (!s || !requirePlatformAdmin(s)) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const results: string[] = [];

  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "propertyId" TEXT`);
    results.push("User.propertyId added");
  } catch (e) {
    results.push(`User.propertyId: ${e instanceof Error ? e.message : "skipped (likely already present)"}`);
  }

  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Invitation" ADD COLUMN "propertyId" TEXT`);
    results.push("Invitation.propertyId added");
  } catch (e) {
    results.push(`Invitation.propertyId: ${e instanceof Error ? e.message : "skipped (likely already present)"}`);
  }

  return NextResponse.json({ status: "ok", results });
}
