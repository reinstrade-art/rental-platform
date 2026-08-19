import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { parseCallbackMetadata, type StkCallback } from "@/app/lib/mpesa";

/**
 * Where Safaricom tells us what happened to a tier-upgrade prompt — the
 * mirror of /api/mpesa/license-callback, but for a landlord's own
 * self-service package upgrade instead of a platform-admin-raised license
 * bill. Same discipline: nothing here trusts the request beyond matching it
 * to a checkoutRequestId this app itself generated when the prompt was raised.
 */
const ACK = NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as StkCallback | null;
  const cb = body?.Body?.stkCallback;
  if (!cb?.CheckoutRequestID) return ACK;

  const request = await prisma.tierChangeRequest.findUnique({ where: { checkoutRequestId: cb.CheckoutRequestID } });
  if (!request || request.status !== "PENDING") return ACK;

  if (cb.ResultCode !== 0) {
    await prisma.tierChangeRequest.update({
      where: { id: request.id },
      data: { status: "FAILED", resultCode: cb.ResultCode, resultDesc: cb.ResultDesc },
    });
    return ACK;
  }

  const meta = parseCallbackMetadata(body!);

  await prisma.$transaction([
    prisma.tierChangeRequest.update({
      where: { id: request.id },
      data: {
        status: "SUCCESS",
        resultCode: cb.ResultCode,
        resultDesc: cb.ResultDesc,
        mpesaReceiptNumber: meta.mpesaReceiptNumber ?? null,
        reference: meta.mpesaReceiptNumber ?? null,
        confirmedAt: new Date(),
      },
    }),
    prisma.organization.update({ where: { id: request.organizationId }, data: { tier: request.toTier } }),
  ]);

  return ACK;
}
