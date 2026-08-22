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
    include: {
      units: {
        orderBy: { label: "asc" },
        include: { leases: { include: { tenant: true, charges: true, payments: true } } },
      },
      caretakers: { orderBy: { createdAt: "asc" } },
    },
  });
}

// propertyId, when passed, is the caretaker's own property (they work one
// property, never the whole org) — a tenant matches either by being onboarded
// directly for that property (no lease yet) or by having a lease on one of
// its units. Omitted entirely for staff, who aren't scoped to a property.
export async function getTenants(organizationId: string, propertyId?: string) {
  return prisma.tenant.findMany({
    where: {
      organizationId,
      ...(propertyId ? { OR: [{ propertyId }, { leases: { some: { unit: { propertyId } } } }] } : {}),
    },
    include: { leases: { include: { unit: { include: { property: true } } } }, user: true },
    orderBy: { name: "asc" },
  });
}

export async function getTenant(organizationId: string, tenantId: string, propertyId?: string) {
  return prisma.tenant.findFirst({
    where: {
      id: tenantId,
      organizationId,
      ...(propertyId ? { OR: [{ propertyId }, { leases: { some: { unit: { propertyId } } } }] } : {}),
    },
    include: {
      leases: {
        orderBy: { startDate: "desc" },
        include: { unit: { include: { property: true } }, charges: true, payments: true },
      },
      user: { select: { email: true, phone: true, disabledAt: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 20, include: { attachments: true } },
    },
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
      payments: { orderBy: { paidAt: "asc" }, include: { allocations: true } },
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
      prisma.unit.findMany({ where: { organizationId }, select: { id: true, monthlyRent: true, leases: { select: { status: true } } } }),
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
  // Every unit's rent, occupied or vacant — what the portfolio would earn at
  // full occupancy, not what's actually billed. A unit with no monthlyRent
  // set (never priced) contributes nothing, since there's no figure to sum.
  const potentialIncome = units.reduce((sum, u) => sum + (u.monthlyRent ?? 0), 0);

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
    potentialIncome,
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

export async function getVendor(organizationId: string, vendorId: string) {
  return prisma.vendor.findFirst({
    where: { id: vendorId, organizationId },
    include: {
      user: { select: { email: true, phone: true, role: true, disabledAt: true } },
      repairs: { orderBy: { reportedAt: "desc" }, include: { property: true, unit: true } },
      quotes: { orderBy: { createdAt: "desc" }, include: { repair: { include: { property: true, unit: true } } } },
    },
  });
}

export async function getSupplier(organizationId: string, supplierId: string) {
  return prisma.supplier.findFirst({
    where: { id: supplierId, organizationId },
    include: {
      repairs: { orderBy: { reportedAt: "desc" }, include: { property: true, unit: true } },
    },
  });
}

export async function getSuppliers(organizationId: string) {
  return prisma.supplier.findMany({
    where: { organizationId },
    include: { repairs: { select: { id: true, title: true, status: true, property: true, unit: true } } },
    orderBy: { name: "asc" },
  });
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
      supplier: true,
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
      messages: { orderBy: { createdAt: "asc" }, include: { attachments: true } },
    },
  });
}

/**
 * Every tenant thread with at least one message, ordered so whoever has been
 * waiting longest for a reply surfaces first — the point of a staff inbox is
 * finding the person nobody has got back to, which stops being "most recent"
 * the moment it's ignored.
 */
export async function getMessageThreads(organizationId: string) {
  const tenants = await prisma.tenant.findMany({
    where: { organizationId, messages: { some: {} } },
    include: {
      messages: { orderBy: { createdAt: "asc" }, include: { attachments: true } },
      leases: { where: { status: "ACTIVE" }, take: 1, include: { unit: { include: { property: true } } } },
    },
  });

  return tenants
    .map((t) => {
      const last = t.messages[t.messages.length - 1];
      return { tenant: t, last, waiting: last.fromTenant, lease: t.leases[0] };
    })
    .sort((a, b) => {
      if (a.waiting !== b.waiting) return a.waiting ? -1 : 1;
      return a.waiting ? a.last.createdAt.getTime() - b.last.createdAt.getTime() : b.last.createdAt.getTime() - a.last.createdAt.getTime();
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
    where: { organizationId, role: { in: ["ADMIN", "MANAGER", "VIEWER", "CARETAKER"] } },
    include: { property: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
}

// Staff/caretaker invites specifically — never tenant/vendor invites, which
// have their own "Invite to register" affordance on the Tenants/Vendors
// pages instead. Expired-but-unused rows are still returned (not filtered
// out) so an admin can see why a link stopped working, rather than it just
// quietly vanishing from the list.
export async function getPendingInvitations(organizationId: string) {
  return prisma.invitation.findMany({
    where: { organizationId, role: { in: ["MANAGER", "VIEWER", "CARETAKER"] }, usedAt: null },
    orderBy: { createdAt: "desc" },
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
