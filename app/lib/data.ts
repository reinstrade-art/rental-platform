import "server-only";
import { prisma } from "./prisma";
import { otherSessions } from "./auth";

// Every function here takes organizationId as a required, non-optional first
// argument and threads it into every query. This is the whole isolation
// mechanism for a shared-schema multi-tenant app — there is no database-level
// enforcement, so a query built here without it is a data leak between
// landlord customers. Never add a variant that omits it.

export function monthRange(d: Date = new Date()) {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return { start, end };
}

export async function getProperties(organizationId: string) {
  return prisma.property.findMany({
    where: { organizationId },
    include: { units: true },
    orderBy: { name: "asc" },
  });
}

export async function getProperty(organizationId: string, propertyId: string) {
  return prisma.property.findFirst({
    where: { id: propertyId, organizationId },
    include: { units: { include: { leases: { include: { tenant: true } } } } },
  });
}

export async function getTenants(organizationId: string) {
  return prisma.tenant.findMany({
    where: { organizationId },
    include: { leases: { include: { unit: { include: { property: true } } } }, user: true },
    orderBy: { name: "asc" },
  });
}

export async function getLeases(organizationId: string) {
  return prisma.lease.findMany({
    where: { organizationId },
    include: { tenant: true, unit: { include: { property: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getLease(organizationId: string, leaseId: string) {
  return prisma.lease.findFirst({
    where: { id: leaseId, organizationId },
    include: {
      tenant: true,
      unit: { include: { property: true } },
      charges: { orderBy: { periodMonth: "asc" } },
      payments: { orderBy: { paidAt: "asc" } },
    },
  });
}

/** balance = charges − payments; positive means the tenant owes. */
export function leaseBalance(lease: { charges: { amount: number }[]; payments: { amount: number }[] }) {
  const charged = lease.charges.reduce((sum, c) => sum + c.amount, 0);
  const paid = lease.payments.reduce((sum, p) => sum + p.amount, 0);
  return charged - paid;
}

export async function getDashboard(organizationId: string, at: Date = new Date()) {
  const { start, end } = monthRange(at);

  const [properties, units, tenants, leases, charges, payments, allCharges, allPayments] =
    await Promise.all([
      prisma.property.count({ where: { organizationId } }),
      prisma.unit.findMany({ where: { organizationId }, select: { id: true, leases: { select: { status: true } } } }),
      prisma.tenant.count({ where: { organizationId } }),
      prisma.lease.count({ where: { organizationId, status: "ACTIVE" } }),
      prisma.charge.findMany({ where: { organizationId, periodMonth: { gte: start, lt: end } }, select: { amount: true } }),
      prisma.payment.findMany({ where: { organizationId, paidAt: { gte: start, lt: end } }, select: { amount: true } }),
      prisma.charge.groupBy({ by: ["leaseId"], where: { organizationId }, _sum: { amount: true } }),
      prisma.payment.groupBy({ by: ["leaseId"], where: { organizationId }, _sum: { amount: true } }),
    ]);

  const billedThisMonth = charges.reduce((s, c) => s + c.amount, 0);
  const receivedThisMonth = payments.reduce((s, p) => s + p.amount, 0);

  const paidByLease = new Map(allPayments.map((p) => [p.leaseId, p._sum.amount ?? 0]));
  const grossArrears = allCharges.reduce((sum, c) => {
    const balance = (c._sum.amount ?? 0) - (paidByLease.get(c.leaseId) ?? 0);
    return sum + Math.max(0, balance);
  }, 0);

  const occupiedUnits = units.filter((u) => u.leases.some((l) => l.status === "ACTIVE")).length;

  return {
    period: start,
    propertyCount: properties,
    unitCount: units.length,
    occupiedUnits,
    tenantCount: tenants,
    activeLeaseCount: leases,
    billedThisMonth,
    receivedThisMonth,
    grossArrears,
  };
}

export async function getPropertyRollups(organizationId: string, at: Date = new Date()) {
  const { start, end } = monthRange(at);
  const properties = await prisma.property.findMany({
    where: { organizationId },
    include: {
      units: {
        include: {
          leases: {
            include: {
              charges: { where: { periodMonth: { gte: start, lt: end } } },
              payments: { where: { paidAt: { gte: start, lt: end } } },
            },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return properties.map((p) => {
    const unitCount = p.units.length;
    let occupied = 0;
    let billed = 0;
    let received = 0;
    for (const u of p.units) {
      if (u.leases.some((l) => l.status === "ACTIVE")) occupied++;
      for (const l of u.leases) {
        billed += l.charges.reduce((s, c) => s + c.amount, 0);
        received += l.payments.reduce((s, pay) => s + pay.amount, 0);
      }
    }
    return { id: p.id, name: p.name, unitCount, occupied, billed, received };
  });
}

export async function getEvictions(organizationId: string) {
  return prisma.eviction.findMany({
    where: { organizationId },
    include: { lease: { include: { tenant: true, unit: { include: { property: true } } } } },
    orderBy: { createdAt: "asc" },
  });
}

export async function getEviction(organizationId: string, evictionId: string) {
  return prisma.eviction.findFirst({
    where: { id: evictionId, organizationId },
    include: { lease: { include: { tenant: true, unit: { include: { property: true } } } } },
  });
}

export async function getVendors(organizationId: string) {
  return prisma.vendor.findMany({ where: { organizationId }, include: { user: true }, orderBy: { name: "asc" } });
}

export async function getRepairs(organizationId: string) {
  return prisma.repair.findMany({
    where: { organizationId },
    include: { property: true, unit: true, awardedVendor: true },
    orderBy: { reportedAt: "desc" },
  });
}

export async function getRepairSummary(organizationId: string) {
  const [pending, done] = await Promise.all([
    prisma.repair.findMany({
      where: { organizationId, status: { notIn: ["DONE", "CANCELLED"] } },
      select: { approvedCost: true },
    }),
    prisma.repair.findMany({
      where: { organizationId, status: "DONE" },
      select: { finalCost: true },
    }),
  ]);
  return {
    pendingCount: pending.length,
    pendingCost: pending.reduce((s, r) => s + (r.approvedCost ?? 0), 0),
    doneCount: done.length,
    doneCost: done.reduce((s, r) => s + (r.finalCost ?? 0), 0),
  };
}

export async function getRepair(organizationId: string, repairId: string) {
  return prisma.repair.findFirst({
    where: { id: repairId, organizationId },
    include: {
      property: true,
      unit: true,
      awardedVendor: true,
      quotes: { include: { vendor: true }, orderBy: { createdAt: "asc" } },
    },
  });
}

// --- outside portals ---------------------------------------------------
// Keyed on the session's own tenantId/vendorId, never on anything from the
// URL — there is no id for a tenant or tradesman to tamper with, only their
// own record, which the session already resolved to at login.

export async function getTenantPortal(tenantId: string) {
  return prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    include: {
      leases: {
        include: {
          unit: { include: { property: true } },
          charges: { orderBy: { periodMonth: "asc" } },
          payments: { orderBy: { paidAt: "asc" } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

export async function getTransactions(organizationId: string) {
  return prisma.transaction.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function getStaff(organizationId: string) {
  return prisma.user.findMany({
    where: { organizationId, role: { in: ["ADMIN", "MANAGER", "VIEWER"] } },
    orderBy: { createdAt: "asc" },
  });
}

export async function getOwnOtherSessions(userId: string) {
  return otherSessions(userId);
}

export async function getVendorPortal(vendorId: string) {
  const [awardedRepairs, quotes] = await Promise.all([
    prisma.repair.findMany({
      where: { awardedVendorId: vendorId },
      include: { property: true, unit: true },
      orderBy: { reportedAt: "desc" },
    }),
    prisma.quote.findMany({
      where: { vendorId },
      include: { repair: { include: { property: true, unit: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return { awardedRepairs, quotes };
}
