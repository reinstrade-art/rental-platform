import { NextResponse } from "next/server";
import { getSession, requirePlatformAdmin } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

/**
 * One-time helper to populate the "Demo" organization with sample-but-clearly-
 * fake data (properties/units/tenants/leases/charges/payments/a repair/an
 * expense), so store-listing screenshots and manual testing show a
 * real-looking, populated app instead of an empty "No properties yet." state.
 * Everything it creates is prefixed "Demo — " and idempotent (re-running
 * skips anything already present by name) so it's safe to hit more than
 * once and easy to find/delete later. Platform-admin gated, same as the
 * other internal migrate/seed routes. Delete once the screenshots are taken.
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
  const monthStart = (offset: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const eightMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 8, 1);

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

  async function upsertLease(unitId: string, tenantId: string, monthlyRent: number, startDate: Date) {
    const existing = await prisma.lease.findFirst({ where: { unitId, tenantId } });
    if (existing) return existing;
    const created = await prisma.lease.create({
      data: { organizationId: org!.id, unitId, tenantId, monthlyRent, startDate, status: "ACTIVE" },
    });
    results.push(`Created lease for unit ${unitId}`);
    return created;
  }

  async function upsertCharge(leaseId: string, type: string, amount: number, description: string, period: Date) {
    const existing = await prisma.charge.findFirst({ where: { leaseId, type, periodMonth: period } });
    if (existing) return existing;
    const created = await prisma.charge.create({
      data: { organizationId: org!.id, leaseId, type, amount, description, periodMonth: period },
    });
    results.push(`Charged ${type} on lease ${leaseId} for ${period.toISOString().slice(0, 7)}`);
    return created;
  }

  async function recordPayment(leaseId: string, amount: number, method: string, reference: string, paidAt: Date) {
    const existing = await prisma.payment.findFirst({ where: { leaseId, reference } });
    if (existing) return existing;
    const created = await prisma.payment.create({
      data: { organizationId: org!.id, leaseId, amount, method, reference, paidAt },
    });
    results.push(`Recorded ${method} payment ${reference} on lease ${leaseId}`);
    return created;
  }

  // --- Properties & units -------------------------------------------------
  const heights = await upsertProperty("Demo — Sample Heights", "Ngong Road, Nairobi");
  const riverside = await upsertProperty("Demo — Riverside Court", "Riverside Drive, Nairobi");
  const sunset = await upsertProperty("Demo — Sunset Apartments", "Thika Road, Nairobi");

  const unitA1 = await upsertUnit(heights.id, "A1", 28000);
  const unitA2 = await upsertUnit(heights.id, "A2", 25000);
  await upsertUnit(heights.id, "A3", 26000); // left vacant, deliberately no lease below
  const unitB1 = await upsertUnit(riverside.id, "B1", 42000);
  const unitB2 = await upsertUnit(riverside.id, "B2", 38000);
  const unitC1 = await upsertUnit(sunset.id, "C1", 32000);
  await upsertUnit(sunset.id, "C2", 30000); // left vacant, deliberately no lease below

  // --- Tenants & leases ----------------------------------------------------
  const grace = await upsertTenant("Grace Wanjiru", "0712345678", "grace.wanjiru@example.com");
  const peter = await upsertTenant("Peter Otieno", "0723456789", "peter.otieno@example.com");
  const amina = await upsertTenant("Amina Hassan", "0734567890", "amina.hassan@example.com");
  const daniel = await upsertTenant("Daniel Kiprop", "0745678901", "daniel.kiprop@example.com");
  const susan = await upsertTenant("Susan Mwikali", "0756789012", "susan.mwikali@example.com");

  const leaseGrace = await upsertLease(unitA1.id, grace.id, 28000, eightMonthsAgo);
  const leasePeter = await upsertLease(unitA2.id, peter.id, 25000, eightMonthsAgo);
  const leaseAmina = await upsertLease(unitB1.id, amina.id, 42000, threeMonthsAgo);
  const leaseDaniel = await upsertLease(unitB2.id, daniel.id, 38000, eightMonthsAgo);
  const leaseSusan = await upsertLease(unitC1.id, susan.id, 32000, threeMonthsAgo);

  // --- Payment history: 6 months of billing so YTD/trend figures are real ---
  // Grace: always billed and paid in full the same month — a clean "on time" tenant.
  for (let m = 5; m >= 0; m--) {
    const period = monthStart(m);
    const rent = await upsertCharge(leaseGrace.id, "RENT", 28000, "Monthly rent", period);
    await recordPayment(leaseGrace.id, 28000, "MPESA", `RCPT-GW-${m}`, new Date(period.getTime() + 3 * 864e5));
    void rent;
  }

  // Peter: pays late/partial some months — a realistic, imperfect payer.
  for (let m = 5; m >= 0; m--) {
    const period = monthStart(m);
    await upsertCharge(leasePeter.id, "RENT", 25000, "Monthly rent", period);
    if (m !== 0) {
      // Every month except the current one gets paid, and one of them only partially.
      const amount = m === 2 ? 15000 : 25000;
      await recordPayment(leasePeter.id, amount, "MPESA", `RCPT-PO-${m}`, new Date(period.getTime() + 10 * 864e5));
    }
  }

  // Daniel: same pattern as Grace on a different unit, so Riverside Court isn't empty.
  for (let m = 5; m >= 0; m--) {
    const period = monthStart(m);
    await upsertCharge(leaseDaniel.id, "RENT", 38000, "Monthly rent", period);
    await recordPayment(leaseDaniel.id, 38000, "BANK", `RCPT-DK-${m}`, new Date(period.getTime() + 2 * 864e5));
  }

  // Amina & Susan: newer leases (3 months), billed but never paid — the
  // "arrears mounting" state, including the current month.
  for (let m = 2; m >= 0; m--) {
    await upsertCharge(leaseAmina.id, "RENT", 42000, "Monthly rent", monthStart(m));
    await upsertCharge(leaseSusan.id, "RENT", 32000, "Monthly rent", monthStart(m));
  }

  // Current month's utility charges on the on-time tenants, to show variety
  // beyond plain RENT in the charges tables.
  await upsertCharge(leaseGrace.id, "WATER", 1400, "Water services", monthStart(0));
  await upsertCharge(leaseGrace.id, "HYGIENE", 600, "Hygiene services", monthStart(0));
  await upsertCharge(leaseDaniel.id, "WATER", 1800, "Water services", monthStart(0));

  // --- Vendor, repair & expense: exercises the Repairs/Vendors/Expenses modules ---
  let vendor = await prisma.vendor.findFirst({ where: { organizationId: org.id, name: "Demo — Kamau Plumbing" } });
  if (!vendor) {
    vendor = await prisma.vendor.create({
      data: {
        organizationId: org.id,
        name: "Demo — Kamau Plumbing",
        trade: "Plumbing",
        contactName: "John Kamau",
        phone: "0767890123",
        prequalified: true,
      },
    });
    results.push("Created vendor Demo — Kamau Plumbing");
  }

  let repair = await prisma.repair.findFirst({ where: { organizationId: org.id, title: "Water heater estimate" } });
  if (!repair) {
    repair = await prisma.repair.create({
      data: {
        organizationId: org.id,
        propertyId: heights.id,
        unitId: unitA2.id,
        title: "Water heater estimate",
        description: "Water heater in A2 not holding temperature — needs a quote before replacing.",
        category: "Plumbing",
        priority: "HIGH",
        status: "QUOTING",
        workOrderSentAt: now,
        workOrderRef: "WO-1042",
      },
    });
    results.push("Created repair: Water heater estimate");
  }
  const existingQuote = await prisma.quote.findFirst({ where: { repairId: repair.id, vendorId: vendor.id } });
  if (!existingQuote) {
    await prisma.quote.create({
      data: { organizationId: org.id, repairId: repair.id, vendorId: vendor.id, amount: 1180, notes: "Includes parts and labour" },
    });
    results.push("Recorded quote for the water heater repair");
  }

  const existingExpense = await prisma.expense.findFirst({ where: { organizationId: org.id, category: "Demo — Garden maintenance" } });
  if (!existingExpense) {
    const orgAdmin = await prisma.user.findFirst({ where: { organizationId: org.id, role: "ADMIN" } });
    await prisma.expense.create({
      data: {
        organizationId: org.id,
        propertyId: sunset.id,
        category: "Demo — Garden maintenance",
        amount: 4500,
        paidAt: monthStart(0),
        recordedBy: orgAdmin?.id ?? s.userId,
      },
    });
    results.push("Created expense: Garden maintenance");
  }

  return NextResponse.json({
    status: "ok",
    organization: org.name,
    summary: {
      properties: 3,
      units: 7,
      vacantUnits: 2,
      tenants: 5,
      monthsOfHistory: 6,
    },
    results,
  });
}
