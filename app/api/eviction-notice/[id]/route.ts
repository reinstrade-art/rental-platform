import { NextResponse } from "next/server";
import { getSession, requireStaff, requireTenant } from "@/app/lib/auth";
import { buildNoticeDoc, noticeDocName } from "@/app/lib/eviction";
import { prisma } from "@/app/lib/prisma";
import { canViewTenantDetails } from "@/app/lib/pii";

// Staff of the case's organization, or the tenant it was raised against —
// same allow-list shape as allowLeaseDoc in app/lib/auth.ts, so a tenant
// sent this link (e.g. via the WhatsApp button) can open it once logged
// into their own portal, without a separate public share-token system.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  const { id } = await params;
  const ev = await prisma.eviction.findFirst({
    where: { id },
    include: { lease: { include: { tenant: true } } },
  });
  if (!ev) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const allowed =
    (requireStaff(s) && s.organizationId === ev.organizationId && canViewTenantDetails(s)) ||
    (requireTenant(s) && s.organizationId === ev.organizationId && s.tenantId === ev.lease.tenantId);
  if (!allowed) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const pdf = await buildNoticeDoc(ev.organizationId, id);
  if (!pdf) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${noticeDocName(ev.lease.tenant.name)}"`,
    },
  });
}
