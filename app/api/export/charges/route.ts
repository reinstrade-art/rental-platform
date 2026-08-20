import { NextRequest, NextResponse } from "next/server";
import { getSession, requireStaff } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { toCsv, csvResponseHeaders } from "@/app/lib/csv-export";

/** A row per billed charge (rent, deposit, water, ...) — the income side of the ledger before payment, for accrual-basis bookkeeping. */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!requireStaff(s)) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");

  const charges = await prisma.charge.findMany({
    where: {
      organizationId: s.organizationId,
      ...(from || to
        ? { periodMonth: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}) } }
        : {}),
    },
    include: { lease: { include: { tenant: true, unit: { include: { property: true } } } } },
    orderBy: { periodMonth: "asc" },
  });

  const csv = toCsv(
    ["Period", "Property", "Unit", "Tenant", "Type", "Description", "Amount"],
    charges.map((c) => [
      c.periodMonth.toISOString().slice(0, 7),
      c.lease.unit.property.name,
      c.lease.unit.label,
      c.lease.tenant.name,
      c.type,
      c.description ?? "",
      c.amount,
    ]),
  );

  return new NextResponse(csv, { headers: csvResponseHeaders("charges.csv") });
}
