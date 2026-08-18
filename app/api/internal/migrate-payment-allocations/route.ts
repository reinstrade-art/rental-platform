import { NextResponse } from "next/server";
import { getSession, requirePlatformAdmin } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

/**
 * One-time schema migration, run over HTTP because this production
 * database's connection string is a Vercel "Sensitive" env var — by design
 * unreadable outside the deployed runtime, so `prisma migrate deploy` can't
 * be run against it from a local shell. Platform-admin gated, and every
 * statement is idempotent (IF NOT EXISTS), so hitting this twice is
 * harmless. Delete this route once the migration has been confirmed applied.
 */
export async function GET() {
  const s = await getSession();
  if (!s || !requirePlatformAdmin(s)) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "PaymentAllocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentAllocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PaymentAllocation_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PaymentAllocation_chargeId_idx" ON "PaymentAllocation"("chargeId")`);

  return NextResponse.json({ status: "ok", message: "PaymentAllocation table is present." });
}
