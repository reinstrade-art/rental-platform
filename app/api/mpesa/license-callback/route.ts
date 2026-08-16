import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { parseCallbackMetadata, type StkCallback } from "@/app/lib/mpesa";
import { extendLicense } from "@/app/lib/licensing";

/**
 * Where Safaricom tells us what happened to a license-billing prompt —
 * the mirror of /api/mpesa/callback, but for the platform's own shortcode
 * billing an organization, never an organization's own tenant-rent flow.
 * Same discipline: nothing here trusts the request beyond matching it to a
 * checkoutRequestId this app itself generated when the prompt was raised.
 */
const ACK = NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as StkCallback | null;
  const cb = body?.Body?.stkCallback;
  if (!cb?.CheckoutRequestID) return ACK;

  const payment = await prisma.licensePayment.findUnique({ where: { checkoutRequestId: cb.CheckoutRequestID } });
  if (!payment || payment.status !== "PENDING") return ACK;

  if (cb.ResultCode !== 0) {
    await prisma.licensePayment.update({
      where: { id: payment.id },
      data: { status: "FAILED", resultCode: cb.ResultCode, resultDesc: cb.ResultDesc },
    });
    return ACK;
  }

  const meta = parseCallbackMetadata(body!);

  await prisma.licensePayment.update({
    where: { id: payment.id },
    data: {
      status: "SUCCESS",
      resultCode: cb.ResultCode,
      resultDesc: cb.ResultDesc,
      mpesaReceiptNumber: meta.mpesaReceiptNumber ?? null,
      reference: meta.mpesaReceiptNumber ?? null,
    },
  });

  // The PENDING row already recorded amount/periodDays when the prompt was
  // raised; extendLicense creates its own SUCCESS row and would double-count
  // this one, so the license window is pushed forward directly here instead.
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: payment.organizationId } });
  const base = org.licenseExpiresAt && org.licenseExpiresAt > new Date() ? org.licenseExpiresAt : new Date();
  await prisma.organization.update({
    where: { id: payment.organizationId },
    data: { licenseExpiresAt: new Date(base.getTime() + payment.periodDays * 86_400_000) },
  });

  return ACK;
}
