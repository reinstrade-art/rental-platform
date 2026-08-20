import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { authenticateApiKey } from "@/app/lib/api-keys";

/** GET /api/v1/leases — Authorization: Bearer <key>. Every lease on file for the key's org. */
export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth) return NextResponse.json({ error: "Missing or invalid API key." }, { status: 401 });

  const leases = await prisma.lease.findMany({
    where: { organizationId: auth.organizationId },
    include: { tenant: { select: { name: true } }, unit: { select: { label: true, property: { select: { name: true } } } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    data: leases.map((l) => ({
      id: l.id,
      status: l.status,
      tenant: l.tenant.name,
      property: l.unit.property.name,
      unit: l.unit.label,
      monthlyRent: l.monthlyRent,
      startDate: l.startDate.toISOString().slice(0, 10),
      endDate: l.endDate ? l.endDate.toISOString().slice(0, 10) : null,
    })),
  });
}
