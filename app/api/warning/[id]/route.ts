import { NextResponse } from "next/server";
import { getSession, requireStaff, requireTenant } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { canViewTenantDetails } from "@/app/lib/pii";
import { buildWarningDoc, warningDocName } from "@/app/lib/warnings";

/**
 * A warning letter as a PDF. Readable by the office (managers, directors and
 * admins — the letter prints the tenant's full name) and by the tenant it was
 * addressed to, from their own portal. When the tenant opens it, that is
 * recorded as viewedAt — the closest thing to a read receipt, and the proof
 * the office wants if the matter ever goes further.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const w = await prisma.tenantWarning.findFirst({
    where: { id },
    include: { lease: { select: { tenantId: true, tenant: { select: { name: true } } } } },
  });
  if (!w) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const staffOk = requireStaff(s) && s.organizationId === w.organizationId && canViewTenantDetails(s);
  const tenantOk = requireTenant(s) && s.organizationId === w.organizationId && s.tenantId === w.lease.tenantId;
  if (!staffOk && !tenantOk) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const pdf = await buildWarningDoc(w.organizationId, id);
  if (!pdf) return NextResponse.json({ error: "Not found." }, { status: 404 });

  if (tenantOk && !w.viewedAt) {
    await prisma.tenantWarning.update({ where: { id }, data: { viewedAt: new Date() } }).catch(() => {});
  }

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${warningDocName(w.lease.tenant.name, w.kind)}"`,
    },
  });
}
