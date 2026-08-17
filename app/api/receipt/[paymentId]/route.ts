import { NextResponse } from "next/server";
import { allowPaymentDoc } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { buildReceiptPdf } from "@/app/lib/receipt";

export async function GET(_req: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const s = await allowPaymentDoc(paymentId);
  if (!s) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: {
      lease: {
        include: {
          tenant: true,
          unit: { include: { property: true } },
          organization: true,
          charges: { select: { amount: true, periodMonth: true, type: true, description: true } },
          payments: { select: { amount: true, paidAt: true } },
        },
      },
    },
  });

  // Balance as of this payment's date — not the lease's current balance —
  // so a receipt printed today still shows what was owed at the time.
  const chargedToDate = payment.lease.charges
    .filter((c) => c.periodMonth <= payment.paidAt)
    .reduce((s, c) => s + c.amount, 0);
  const paidToDate = payment.lease.payments
    .filter((p) => p.paidAt <= payment.paidAt)
    .reduce((s, p) => s + p.amount, 0);
  const balanceAfter = chargedToDate - paidToDate;

  // What this tenancy was billed for the same calendar month as the payment
  // — an itemized "what this was for" alongside the lump amount received,
  // since a payment itself isn't earmarked to any one charge (see settle.ts).
  const periodKey = (d: Date) => `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
  const paidPeriod = periodKey(payment.paidAt);
  const periodCharges = payment.lease.charges.filter((c) => periodKey(c.periodMonth) === paidPeriod);

  const pdf = await buildReceiptPdf({
    org: payment.lease.organization,
    payment,
    tenant: payment.lease.tenant,
    unit: payment.lease.unit,
    property: payment.lease.unit.property,
    balanceAfter,
    periodCharges,
  });

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="receipt-${payment.id.slice(-8)}.pdf"`,
    },
  });
}
