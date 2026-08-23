import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { authenticateApiKey } from "@/app/lib/api-keys";
import { dispatchWebhookEvent } from "@/app/lib/webhooks";

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

/**
 * POST /api/v1/charges — Authorization: Bearer <key>.
 * Body: { leaseId, type, amount, periodMonth, description? }
 * Create-only, same reasoning as POST /api/v1/payments.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth) return NextResponse.json({ error: "Missing or invalid API key." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });

  const leaseId = String(body.leaseId ?? "");
  const type = String(body.type ?? "RENT");
  const amount = Number(body.amount ?? 0);
  const description = body.description ? String(body.description).trim() : null;
  const periodMonth = new Date(String(body.periodMonth ?? ""));
  if (!leaseId || !amount || amount <= 0 || isNaN(periodMonth.getTime())) {
    return NextResponse.json({ error: "leaseId, a positive amount, and periodMonth are required." }, { status: 400 });
  }

  const lease = await prisma.lease.findFirst({ where: { id: leaseId, organizationId: auth.organizationId } });
  if (!lease) return NextResponse.json({ error: "Lease not found." }, { status: 404 });

  const charge = await prisma.charge.create({
    data: { organizationId: auth.organizationId, leaseId, type, amount, description, periodMonth },
  });

  after(() =>
    dispatchWebhookEvent(auth.organizationId, "charge.added", {
      id: charge.id,
      leaseId,
      type,
      amount,
      periodMonth: periodMonth.toISOString().slice(0, 7),
    }),
  );

  return NextResponse.json({ id: charge.id }, { status: 201 });
}
