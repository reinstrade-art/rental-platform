import { NextResponse } from "next/server";
import { allowLeaseDoc } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { buildInvoicePdf } from "@/app/lib/invoice";

export async function GET(req: Request, { params }: { params: Promise<{ leaseId: string }> }) {
  const { leaseId } = await params;
  const s = await allowLeaseDoc(leaseId);
  if (!s) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const periodParam = new URL(req.url).searchParams.get("period"); // YYYY-MM
  const now = new Date();
  const [y, m] = periodParam?.split("-").map(Number) ?? [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const period = new Date(Date.UTC(y, (m ?? 1) - 1, 1));
  const periodEnd = new Date(Date.UTC(y, (m ?? 1), 1));

  const lease = await prisma.lease.findUniqueOrThrow({
    where: { id: leaseId },
    include: {
      tenant: true,
      unit: { include: { property: true } },
      organization: true,
      charges: { where: { periodMonth: { gte: period, lt: periodEnd } }, orderBy: { createdAt: "asc" } },
    },
  });

  const pdf = await buildInvoicePdf({
    org: lease.organization,
    period,
    tenant: lease.tenant,
    unit: lease.unit,
    property: lease.unit.property,
    charges: lease.charges,
  });

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="invoice-${lease.id.slice(-8)}-${y}-${String(m).padStart(2, "0")}.pdf"`,
    },
  });
}
