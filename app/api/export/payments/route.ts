import { NextRequest, NextResponse } from "next/server";
import { getSession, requireStaff } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { toCsv, csvResponseHeaders } from "@/app/lib/csv-export";
import { tenantView } from "@/app/lib/pii";

/**
 * A row per recorded payment, in a shape any bookkeeping import (QuickBooks,
 * Xero, Sage, a plain spreadsheet) can read without translation — dates as
 * plain YYYY-MM-DD, one amount column, no nested structure. from/to bound
 * paidAt inclusively; omitted entirely exports everything on file.
 */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!requireStaff(s)) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const v = tenantView(s); // surnames masked below manager/director/admin
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");

  const payments = await prisma.payment.findMany({
    where: {
      organizationId: s.organizationId,
      ...(from || to
        ? { paidAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}) } }
        : {}),
    },
    include: { lease: { include: { tenant: true, unit: { include: { property: true } } } } },
    orderBy: { paidAt: "asc" },
  });

  const csv = toCsv(
    ["Date", "Property", "Unit", "Tenant", "Amount", "Method", "Reference"],
    payments.map((p) => [
      p.paidAt.toISOString().slice(0, 10),
      p.lease.unit.property.name,
      p.lease.unit.label,
      v.name(p.lease.tenant.name),
      p.amount,
      p.method ?? "",
      p.reference ?? "",
    ]),
  );

  return new NextResponse(csv, { headers: csvResponseHeaders("payments.csv") });
}
