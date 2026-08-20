import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { authenticateApiKey } from "@/app/lib/api-keys";

/** GET /api/v1/payments?from=YYYY-MM-DD&to=YYYY-MM-DD — Authorization: Bearer <key>. Both bounds optional and inclusive on paidAt. */
export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth) return NextResponse.json({ error: "Missing or invalid API key." }, { status: 401 });

  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");

  const payments = await prisma.payment.findMany({
    where: {
      organizationId: auth.organizationId,
      ...(from || to
        ? { paidAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}) } }
        : {}),
    },
    include: { lease: { include: { tenant: { select: { name: true } }, unit: { select: { label: true, property: { select: { name: true } } } } } } },
    orderBy: { paidAt: "asc" },
  });

  return NextResponse.json({
    data: payments.map((p) => ({
      id: p.id,
      date: p.paidAt.toISOString().slice(0, 10),
      property: p.lease.unit.property.name,
      unit: p.lease.unit.label,
      tenant: p.lease.tenant.name,
      amount: p.amount,
      method: p.method,
      reference: p.reference,
    })),
  });
}
