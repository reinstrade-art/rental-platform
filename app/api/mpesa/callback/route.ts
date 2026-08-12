import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { parseCallbackMetadata, type StkCallback } from "@/app/lib/mpesa";
import { matchTransaction } from "@/app/lib/payments";

/**
 * Where Safaricom tells us what happened to a prompt.
 *
 * No session, no shared secret — Safaricom cannot supply either, so this
 * route is protected the way every public webhook is: nothing here trusts
 * the request beyond matching it to a checkoutRequestId this app itself
 * generated. One shared route for every organization — the org is resolved
 * from the MpesaRequest row, never taken from the request body.
 *
 * Safaricom always expects HTTP 200 with this exact shape back, whatever
 * happened on our side — anything else and it retries on a schedule that
 * only makes duplicates more likely.
 */
const ACK = NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as StkCallback | null;
  const cb = body?.Body?.stkCallback;
  if (!cb?.CheckoutRequestID) return ACK;

  const request = await prisma.mpesaRequest.findUnique({ where: { checkoutRequestId: cb.CheckoutRequestID } });
  if (!request || request.status !== "PENDING") return ACK;

  if (cb.ResultCode !== 0) {
    await prisma.mpesaRequest.update({
      where: { id: request.id },
      data: { status: "FAILED", resultCode: cb.ResultCode, resultDesc: cb.ResultDesc },
    });
    return ACK;
  }

  const meta = parseCallbackMetadata(body!);
  const amount = meta.amount ?? request.amount;

  // The lease is already known with certainty — it was fixed the moment the
  // prompt was raised — so this goes straight to matchTransaction rather
  // than through the reference-guessing auto-match pass every other source
  // goes through.
  const transaction = await prisma.transaction.create({
    data: {
      organizationId: request.organizationId,
      source: "MPESA_STK",
      amount,
      reference: meta.mpesaReceiptNumber ?? null,
      occurredAt: new Date(),
      rawPayload: JSON.stringify(body),
    },
  });
  const matched = await matchTransaction(request.organizationId, transaction.id, request.leaseId, null);

  await prisma.mpesaRequest.update({
    where: { id: request.id },
    data: {
      status: "SUCCESS",
      resultCode: cb.ResultCode,
      resultDesc: cb.ResultDesc,
      mpesaReceiptNumber: meta.mpesaReceiptNumber ?? null,
      paymentId: matched.matchedPaymentId,
    },
  });

  return ACK;
}
