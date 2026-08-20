import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { authenticateApiKey } from "@/app/lib/api-keys";

/** GET /api/v1/charges?from=YYYY-MM&to=YYYY-MM — Authorization: Bearer <key>. Both bounds optional and inclusive on periodMonth. */
export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth) return NextResponse.json({ error: "Missing or invalid API key." }, { status: 401 });

  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");

  const charges = await prisma.charge.findMany({
    where: {
      organizationId: auth.organizationId,
      ...(from || to
        ? { periodMonth: { ...(from ? { gte: new Date(`${from}-01`) } : {}), ...(to ? { lte: new Date(`${to}-28T23:59:59.999Z`) } : {}) } }
        : {}),
    },
    include: { lease: { include: { tenant: { select: { name: true } }, unit: { select: { label: true, property: { select: { name: true } } } } } } },
    orderBy: { periodMonth: "asc" },
  });

  return NextResponse.json({
    data: charges.map((c) => ({
      id: c.id,
      period: c.periodMonth.toISOString().slice(0, 7),
      property: c.lease.unit.property.name,
      unit: c.lease.unit.label,
      tenant: c.lease.tenant.name,
      type: c.type,
      description: c.description,
      amount: c.amount,
    })),
  });
}
