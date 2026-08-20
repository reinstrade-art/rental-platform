import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { authenticateApiKey } from "@/app/lib/api-keys";

/** GET /api/v1/tenants — Authorization: Bearer <key>. Every tenant on file for the key's org, with their current leases. */
export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth) return NextResponse.json({ error: "Missing or invalid API key." }, { status: 401 });

  const tenants = await prisma.tenant.findMany({
    where: { organizationId: auth.organizationId },
    include: { leases: { select: { id: true, status: true, monthlyRent: true, unit: { select: { label: true, property: { select: { name: true } } } } } } },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({
    data: tenants.map((t) => ({
      id: t.id,
      name: t.name,
      phone: t.phone,
      email: t.email,
      leases: t.leases.map((l) => ({
        id: l.id,
        status: l.status,
        monthlyRent: l.monthlyRent,
        property: l.unit.property.name,
        unit: l.unit.label,
      })),
    })),
  });
}
