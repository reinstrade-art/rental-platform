import { NextRequest, NextResponse, after } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/app/lib/prisma";
import { authenticateApiKey } from "@/app/lib/api-keys";
import { dispatchWebhookEvent } from "@/app/lib/webhooks";
import { syncPayment } from "@/app/lib/accounting-sync";
import { sendPaymentReceipt } from "@/app/lib/receipt";

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

/**
 * POST /api/v1/payments — Authorization: Bearer <key>.
 * Body: { leaseId, amount, method?, reference?, paidAt? }
 *
 * The one write endpoint the desktop app's offline sync queue calls to
 * replay a payment recorded while offline — deliberately narrow (create
 * only, no edit/delete) since this is the "safe, append-only" half of
 * offline actions; nothing here can conflict with a concurrent edit
 * because there is no edit path through this API at all.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth) return NextResponse.json({ error: "Missing or invalid API key." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });

  const leaseId = String(body.leaseId ?? "");
  const amount = Number(body.amount ?? 0);
  const method = body.method ? String(body.method).trim() : null;
  const reference = body.reference ? String(body.reference).trim() : null;
  const paidAt = body.paidAt ? new Date(body.paidAt) : new Date();
  if (!leaseId || !amount || amount <= 0 || isNaN(paidAt.getTime())) {
    return NextResponse.json({ error: "leaseId and a positive amount are required." }, { status: 400 });
  }

  const lease = await prisma.lease.findFirst({ where: { id: leaseId, organizationId: auth.organizationId } });
  if (!lease) return NextResponse.json({ error: "Lease not found." }, { status: 404 });

  let payment;
  try {
    payment = await prisma.payment.create({
      data: { organizationId: auth.organizationId, leaseId, amount, method, reference, paidAt },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // Same reference already recorded — the offline queue's own retry
      // safety net (see the desktop app's outbox), not a real duplicate
      // submission from the caller's point of view. 200, not 409: the
      // payment already exists, which is what the caller wanted.
      const existing = await prisma.payment.findFirst({ where: { organizationId: auth.organizationId, reference } });
      if (existing) return NextResponse.json({ id: existing.id, deduplicated: true });
    }
    throw e;
  }

  after(() =>
    dispatchWebhookEvent(auth.organizationId, "payment.recorded", {
      id: payment.id,
      leaseId,
      amount,
      method,
      reference,
      paidAt: paidAt.toISOString(),
    }),
  );
  after(() => syncPayment(auth.organizationId, payment.id));
  after(() => sendPaymentReceipt(payment.id, req.nextUrl.origin));

  return NextResponse.json({ id: payment.id }, { status: 201 });
}
