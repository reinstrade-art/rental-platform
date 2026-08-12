import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getSession, requireStaff, requireTenant } from "@/app/lib/auth";

/**
 * Polled from the browser every few seconds while a prompt is pending — the
 * confirmation itself arrives on the phone, not this tab, so the page has
 * nothing to react to except asking again.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not allowed." }, { status: 403 });

  const request = await prisma.mpesaRequest.findUnique({
    where: { id },
    select: {
      organizationId: true,
      status: true,
      resultDesc: true,
      amount: true,
      mpesaReceiptNumber: true,
      lease: { select: { tenantId: true } },
    },
  });
  if (!request) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // A tenant may only poll a prompt raised on their own tenancy; staff may
  // poll any prompt in their own organization — the same org+ownership
  // boundary every other document/status route keeps.
  const allowed =
    (requireStaff(s) && s.organizationId === request.organizationId) ||
    (requireTenant(s) && s.organizationId === request.organizationId && s.tenantId === request.lease.tenantId);
  if (!allowed) return NextResponse.json({ error: "Not allowed." }, { status: 403 });

  return NextResponse.json({
    status: request.status,
    resultDesc: request.resultDesc,
    amount: request.amount,
    mpesaReceiptNumber: request.mpesaReceiptNumber,
  });
}
