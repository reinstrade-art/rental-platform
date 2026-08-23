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

/**
 * POST /api/v1/tenants — Authorization: Bearer <key>.
 * Body: { name, phone?, email? }
 * Creates the Tenant record only — no lease, matching the "Add tenant"
 * page's own scope. Create-only, same reasoning as the payments/charges
 * write endpoints.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth) return NextResponse.json({ error: "Missing or invalid API key." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });

  const name = String(body.name ?? "").trim();
  const phone = body.phone ? String(body.phone).trim() : null;
  const email = body.email ? String(body.email).trim() : null;
  if (!name) return NextResponse.json({ error: "name is required." }, { status: 400 });

  const tenant = await prisma.tenant.create({
    data: { organizationId: auth.organizationId, name, phone, email },
  });

  return NextResponse.json({ id: tenant.id }, { status: 201 });
}
