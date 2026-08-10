import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { ingestTransaction } from "@/app/lib/payments";

/**
 * Shaped to match Safaricom's Daraja C2B confirmation callback so that
 * wiring an organization's real paybill later is "point Safaricom at this
 * URL", not a redesign of ingestion. Nothing here is live — no organization
 * has its own paybill yet (the reason HM Kariuki's own integration is
 * blocked: they pay into a paybill they don't own, see project notes).
 *
 * Security note (Phase 1 gap, flagged deliberately rather than hidden):
 * Safaricom does not sign C2B callbacks, so production use needs either IP
 * allowlisting at the edge or a shared secret in the URL/query string —
 * neither is wired up here yet. Do not point a real paybill at this route
 * before that is addressed.
 */
export async function POST(req: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;

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
