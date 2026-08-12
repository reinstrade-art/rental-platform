import { NextResponse } from "next/server";
import { allowLeaseDoc } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { buildStatementPdf } from "@/app/lib/statement-doc";

export async function GET(_req: Request, { params }: { params: Promise<{ leaseId: string }> }) {
  const { leaseId } = await params;
  const s = await allowLeaseDoc(leaseId);
  if (!s) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const lease = await prisma.lease.findUniqueOrThrow({
    where: { id: leaseId },
    include: {
      tenant: true,
      unit: { include: { property: true } },
      organization: true,
      charges: { orderBy: { periodMonth: "asc" } },
      payments: { orderBy: { paidAt: "asc" } },
    },
  });

  const pdf = await buildStatementPdf({
    org: lease.organization,
    tenant: lease.tenant,
    unit: lease.unit,
    property: lease.unit.property,
    charges: lease.charges,
    payments: lease.payments,
  });

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="statement-${lease.id.slice(-8)}.pdf"`,
    },
  });
}
