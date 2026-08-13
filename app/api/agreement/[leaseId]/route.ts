import { NextResponse } from "next/server";
import { allowLeaseDoc } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { buildLeaseDoc, leaseDocName } from "@/app/lib/lease-doc";

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
      charges: { where: { type: "DEPOSIT" }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const pdf = await buildLeaseDoc({
    org: lease.organization,
    tenant: lease.tenant,
    unit: lease.unit,
    property: lease.unit.property,
    monthlyRent: lease.monthlyRent,
    depositAmount: lease.charges[0]?.amount ?? lease.monthlyRent,
    startDate: lease.startDate,
    signature: {
      signatureImage: lease.signatureImage,
      signedAt: lease.signedAt,
      signedByName: lease.signedByName,
      signedIp: lease.signedIp,
    },
  });

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${leaseDocName(lease.tenant.name)}"`,
    },
  });
}
