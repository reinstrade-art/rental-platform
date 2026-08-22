import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { ingestTransaction } from "@/app/lib/payments";
import { mpesaWebhookKey } from "@/app/lib/webhook-secret";

/**
 * Shaped to match Safaricom's Daraja C2B confirmation callback. `key` is a
 * per-org HMAC (see webhook-secret.ts) rather than a session or a shared
 * platform secret — Safaricom does not sign these callbacks at all, so this
 * is the only thing standing between "an org registered this URL as its
 * paybill's ConfirmationURL" and "anyone on the internet can fabricate a
 * rent payment." A wrong or missing key is refused before the payload is
 * even parsed.
 *
 * One route serves as both ConfirmationURL and ValidationURL — Safaricom
 * skips calling ValidationURL entirely once C2B is registered with
 * ResponseType "Completed" (see registerC2bUrls in app/lib/mpesa.ts), so
 * there's no separate accept/reject decision to make here.
 */
export async function POST(req: Request, { params }: { params: Promise<{ organizationId: string; key: string }> }) {
  const { organizationId, key } = await params;

  if (key !== mpesaWebhookKey(organizationId)) {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Rejected." }, { status: 403 });
  }

  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org || org.status !== "ACTIVE") {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Unknown organization." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.TransAmount === "undefined") {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Malformed payload." }, { status: 400 });
  }

  const amount = Number(body.TransAmount);
  const occurredAt = parseDarajaTimestamp(String(body.TransTime ?? "")) ?? new Date();
  const payerName = [body.FirstName, body.MiddleName, body.LastName].filter(Boolean).join(" ") || null;

  await ingestTransaction({
    organizationId,
    source: "MPESA_DARAJA",
    amount,
    reference: body.BillRefNumber ? String(body.BillRefNumber) : null,
    payerName,
    occurredAt,
    rawPayload: body,
  });

  // Safaricom expects this exact shape acknowledging receipt.
  return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
}

/** Daraja timestamps are "yyyyMMddHHmmss" with no separators. */
function parseDarajaTimestamp(s: string): Date | null {
  if (!/^\d{14}$/.test(s)) return null;
  const y = s.slice(0, 4), mo = s.slice(4, 6), d = s.slice(6, 8), h = s.slice(8, 10), mi = s.slice(10, 12), se = s.slice(12, 14);
  const dt = new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}`);
  return isNaN(dt.getTime()) ? null : dt;
}
