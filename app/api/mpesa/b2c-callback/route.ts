import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { parseB2cResult, type B2cCallback } from "@/app/lib/mpesa";

/**
 * Where Safaricom reports what happened to a B2C payout — the mirror image
 * of app/api/mpesa/callback for STK, but keyed on originatorConversationId
 * (the id this app generated when it raised the transfer) rather than a
 * checkoutRequestId, since B2C's request/result shape is different. Used
 * for both ResultURL and QueueTimeOutURL — a queued-out request still
 * arrives shaped as a Result with a non-zero ResultCode.
 */
const ACK = NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as B2cCallback | null;
  const result = body?.Result;
  if (!result?.OriginatorConversationID) return ACK;

  const payout = await prisma.payout.findFirst({
    where: { originatorConversationId: result.OriginatorConversationID },
  });
  if (!payout || payout.status !== "PENDING") return ACK;

  if (result.ResultCode !== 0) {
    await prisma.payout.update({
      where: { id: payout.id },
      data: { status: "FAILED", resultCode: result.ResultCode, resultDesc: result.ResultDesc, completedAt: new Date() },
    });
    return ACK;
  }

  const { mpesaReceiptNumber } = parseB2cResult(body!);
  await prisma.payout.update({
    where: { id: payout.id },
    data: {
      status: "SUCCESS",
      resultCode: result.ResultCode,
      resultDesc: result.ResultDesc,
      mpesaReceiptNumber: mpesaReceiptNumber ?? null,
      completedAt: new Date(),
    },
  });

  return ACK;
}
