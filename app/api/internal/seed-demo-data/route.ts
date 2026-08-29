import { NextResponse } from "next/server";
import { getSession, requirePlatformAdmin } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

/**
 * One-time helper to populate the "Demo" organization with sample-but-clearly-
 * fake data (properties/units/tenants/leases/charges/a payment), so the
 * Android app's store listing screenshots show a real-looking screen instead
 * of an empty "No properties yet." state. Everything it creates is prefixed
 * "Demo — " and idempotent (re-running skips anything already present by
 * name) so it's safe to hit more than once and easy to find/delete later.
 * Platform-admin gated, same as the other internal migrate/seed routes.
 * Delete once the screenshots are taken.
 */
export async function GET() {
  const s = await getSession();
  if (!s || !requirePlatformAdmin(s)) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const org = await prisma.organization.findFirst({ where: { name: "Demo" } });
  if (!org) {
    const names = (await prisma.organization.findMany({ select: { name: true } })).map((o) => o.name);
    return NextResponse.json({ error: 'No organization named "Demo" found.', availableOrganizations: names }, { status: 404 });
  }

  const results: string[] = [];
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);

  async function upsertProperty(name: string, address: string) {
    const existing = await prisma.property.findFirst({ where: { organizationId: org!.id, name } });
    if (existing) return existing;
    const created = await prisma.property.create({ data: { organizationId: org!.id, name, address } });
    results.push(`Created property "${name}"`);
    return created;
  }

  async function upsertUnit(propertyId: string, label: string, monthlyRent: number) {
    const existing = await prisma.unit.findFirst({ where: { propertyId, label } });
    if (existing) return existing;
    const created = await prisma.unit.create({
      data: { propertyId, organizationId: org!.id, label, monthlyRent },
    });
    results.push(`Created unit "${label}"`);
    return created;
  }

  async function upsertTenant(name: string, phone: string, email: string) {
    const existing = await prisma.tenant.findFirst({ where: { organizationId: org!.id, name } });
    if (existing) return existing;
    const created = await prisma.tenant.create({ data: { organizationId: org!.id, name, phone, email } });
    results.push(`Created tenant "${name}"`);
    return created;
  }

  async function upsertLease(unitId: string, tenantId: string, monthlyRent: number) {
    const existing = await prisma.lease.findFirst({ where: { unitId, tenantId } });
    if (existing) return existing;
    const created = await prisma.lease.create({
      data: { organizationId: org!.id, unitId, tenantId, monthlyRent, startDate: threeMonthsAgo, status: "ACTIVE" },
    });
    results.push(`Created lease for unit ${unitId}`);
    return created;
  }

  const heights = await upsertProperty("Demo — Sample Heights", "Ngong Road, Nairobi");
  const riverside = await upsertProperty("Demo — Riverside Court", "Riverside Drive, Nairobi");

  const unitA1 = await upsertUnit(heights.id, "A1", 28000);
  const unitA2 = await upsertUnit(heights.id, "A2", 25000);
  const unitB1 = await upsertUnit(riverside.id, "B1", 42000);

  const grace = await upsertTenant("Grace Wanjiru", "0712345678", "grace.wanjiru@example.com");
  const peter = await upsertTenant("Peter Otieno", "0723456789", "peter.otieno@example.com");
  const amina = await upsertTenant("Amina Hassan", "0734567890", "amina.hassan@example.com");

  const leaseGrace = await upsertLease(unitA1.id, grace.id, 28000);
  const leasePeter = await upsertLease(unitA2.id, peter.id, 25000);
  const leaseAmina = await upsertLease(unitB1.id, amina.id, 42000);

  async function upsertCharge(leaseId: string, type: string, amount: number, description: string) {
    const existing = await prisma.charge.findFirst({ where: { leaseId, type, periodMonth: monthStart } });
    if (existing) return existing;
    const created = await prisma.charge.create({
      data: { organizationId: org!.id, leaseId, type, amount, description, periodMonth: monthStart },
    });
    results.push(`Charged ${type} on lease ${leaseId}`);
    return created;
  }

  // Grace: fully billed and fully paid this month (shows a clean "balance 0" state).
  const graceRent = await upsertCharge(leaseGrace.id, "RENT", 28000, "Monthly rent");
  const graceWater = await upsertCharge(leaseGrace.id, "WATER", 1400, "Water services");
  const graceHygiene = await upsertCharge(leaseGrace.id, "HYGIENE", 600, "Hygiene services");

  const existingPayment = await prisma.payment.findFirst({ where: { leaseId: leaseGrace.id } });
  if (!existingPayment) {
    const payment = await prisma.payment.create({
      data: { organizationId: org!.id, leaseId: leaseGrace.id, amount: 30000, method: "MPESA", reference: "RCPT-7K4M", paidAt: now },
    });
    await prisma.paymentAllocation.createMany({
      data: [
        { organizationId: org!.id, paymentId: payment.id, chargeId: graceRent.id, amount: 28000 },
        { organizationId: org!.id, paymentId: payment.id, chargeId: graceWater.id, amount: 1400 },
        { organizationId: org!.id, paymentId: payment.id, chargeId: graceHygiene.id, amount: 600 },
      ],
    });
    results.push("Recorded full M-Pesa payment for Grace Wanjiru");
  }

  // Peter and Amina: billed but unpaid this month, so the dashboard/leases
  // list has a real arrears figure to show (the "owed shown in red" state).
  await upsertCharge(leasePeter.id, "RENT", 25000, "Monthly rent");
  await upsertCharge(leaseAmina.id, "RENT", 42000, "Monthly rent");

  return NextResponse.json({ status: "ok", organization: org.name, results });
}
