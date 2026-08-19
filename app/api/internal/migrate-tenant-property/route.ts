import { NextResponse } from "next/server";
import { getSession, requirePlatformAdmin } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

/**
 * One-time schema migration, run over HTTP for the same reason as the other
 * migrate-* routes: the production DB connection string is a Vercel
 * Sensitive env var, unreadable outside the deployed runtime.
 *
 * Deployed deliberately BEFORE Tenant.propertyId is added to schema.prisma —
 * the caretaker-role deploy shipped a new User column ahead of this same
 * migration and broke login for everyone, since getSession() runs on every
 * request. Tenant is included even more widely (leases, payments, messages,
 * dashboard), so this time the column is added to the live table first, via
 * this platform-admin-gated raw ALTER TABLE, and only once confirmed does
 * the app code start selecting it. Delete this route once confirmed.
 */
export async function GET() {
  const s = await getSession();
  if (!s || !requirePlatformAdmin(s)) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const results: string[] = [];

  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Tenant" ADD COLUMN "propertyId" TEXT`);
    results.push("Tenant.propertyId added");
  } catch (e) {
    results.push(`Tenant.propertyId: ${e instanceof Error ? e.message : "skipped (likely already present)"}`);
  }

  return NextResponse.json({ status: "ok", results });
}
