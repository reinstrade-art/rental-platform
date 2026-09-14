import "server-only";
import { prisma } from "./prisma";
import { otherSessions, allActiveSessions } from "./auth";

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

/** The whole calendar year, Jan 1 through the following Jan 1. */
export function yearRange(year: number) {
  return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year + 1, 0, 1)) };
}

/** Jan 1 of the given year through today — the current moment for this year, or the year's own close for a past one. */
export function ytdRange(year: number, now: Date = new Date()) {
  const end = year >= now.getUTCFullYear() ? new Date(now.getTime() + 24 * 60 * 60 * 1000) : new Date(Date.UTC(year + 1, 0, 1));
  return { start: new Date(Date.UTC(year, 0, 1)), end };
}

/** One row per calendar month of the given year: total charged vs. total received, org-wide — the Dashboard's "billed against collected" chart. */
export async function getBilledVsCollected(organizationId: string, year: number) {
  const { start, end } = yearRange(year);
  const [charges, payments] = await Promise.all([
    prisma.charge.findMany({ where: { organizationId, periodMonth: { gte: start, lt: end } }, select: { amount: true, periodMonth: true } }),
    prisma.payment.findMany({ where: { organizationId, paidAt: { gte: start, lt: end } }, select: { amount: true, paidAt: true } }),
  ]);
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, billed: 0, collected: 0 }));
  for (const c of charges) months[c.periodMonth.getUTCMonth()].billed += c.amount;
  for (const p of payments) months[p.paidAt.getUTCMonth()].collected += p.amount;
  return months.map((m) => ({ ...m, rate: m.billed > 0 ? Math.round((m.collected / m.billed) * 100) : 0 }));
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
      user: { select: { id: true, email: true, phone: true, disabledAt: true } },
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

export async function getDashboard(organizationId: string, range: { start: Date; end: Date } = monthRange()) {
  const { start, end } = range;

  const [properties, units, tenants, leases, charges, payments, allCharges, allPayments] =
    await Promise.all([
      prisma.property.count({ where: { organizationId } }),
      prisma.unit.findMany({
        where: { organizationId },
        select: { id: true, monthlyRent: true, leases: { select: { status: true, startDate: true, endDate: true, monthlyRent: true } } },
      }),
      prisma.tenant.count({ where: { organizationId } }),
      prisma.lease.count({ where: { organizationId, status: "ACTIVE" } }),
      prisma.charge.findMany({ where: { organizationId, periodMonth: { gte: start, lt: end } }, select: { amount: true } }),
      prisma.payment.findMany({ where: { organizationId, paidAt: { gte: start, lt: end } }, select: { amount: true } }),
      prisma.charge.groupBy({ by: ["leaseId"], where: { organizationId }, _sum: { amount: true } }),
      prisma.payment.groupBy({ by: ["leaseId"], where: { organizationId }, _sum: { amount: true } }),
    ]);

  const billed = charges.reduce((s, c) => s + c.amount, 0);
  const received = payments.reduce((s, p) => s + p.amount, 0);

  const paidByLease = new Map(allPayments.map((p) => [p.leaseId, p._sum.amount ?? 0]));
  const grossArrears = allCharges.reduce((sum, c) => {
    const balance = (c._sum.amount ?? 0) - (paidByLease.get(c.leaseId) ?? 0);
    return sum + Math.max(0, balance);
  }, 0);

  // Occupancy reflects the period being viewed — the lease (if any) that
  // actually covered the unit during that month, not just whoever holds it
  // today, so a past month's occupancy reads as it truly was then.
  const occupiedUnits = units.filter((u) => u.leases.some((l) => l.startDate < end && (!l.endDate || l.endDate >= start))).length;
  // What the portfolio would earn TODAY at full occupancy — the current
  // lease's own rent for an occupied unit (which can differ from the unit's
  // listed rate), or the unit's listed rate when vacant. Deliberately not
  // scoped to the period above, so this stays a stable benchmark rather than
  // swinging with whichever past tenant/rent happened to be in place then.
  const potentialIncome = units.reduce((sum, u) => {
    const current = u.leases.find((l) => l.status === "ACTIVE");
    return sum + (current ? current.monthlyRent : (u.monthlyRent ?? 0));
  }, 0);

  return {
    period: start,
    propertyCount: properties,
    unitCount: units.length,
    occupiedUnits,
    tenantCount: tenants,
    activeLeaseCount: leases,
    billed,
    received,
    grossArrears,
    potentialIncome,
  };
}

export async function getPropertyRollups(organizationId: string, range: { start: Date; end: Date } = monthRange()) {
  const { start, end } = range;
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
      // Period-aware, same rule as getDashboard's occupiedUnits — a lease
      // that actually covered the unit during this month, not just whoever
      // holds it today.
      if (u.leases.some((l) => l.startDate < end && (!l.endDate || l.endDate >= start))) occupied++;
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
    include: { property: true, unit: true, awardedVendor: true, reportedByTenant: true, quotes: true },
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
      reportedByTenant: true,
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
      reportedRepairs: { orderBy: { reportedAt: "desc" }, include: { property: true, unit: true } },
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

/** Every active session on a teammate's account — for an org admin's own session-management page, not the self-service one above. */
export async function getUserSessions(userId: string) {
  return allActiveSessions(userId);
}

/** Active-session counts for every user in an org, one query — the Team page's per-row "Sessions" count. */
export async function getActiveSessionCounts(organizationId: string): Promise<Record<string, number>> {
  const rows = await prisma.session.groupBy({
    by: ["userId"],
    where: { user: { organizationId }, revokedAt: null, expiresAt: { gt: new Date() } },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((r) => [r.userId, r._count._all]));
}

export async function getVendorPortal(organizationId: string, vendorId: string) {
  const [awardedRepairs, quotes, openForQuoting] = await Promise.all([
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
    // Work orders this vendor could still bid on: sent out, not yet awarded,
    // and this vendor hasn't already put in a quote (that's the list above).
    prisma.repair.findMany({
      where: {
        organizationId,
        status: "QUOTING",
        awardedVendorId: null,
        quotes: { none: { vendorId } },
      },
      include: { property: true, unit: true },
      orderBy: { reportedAt: "desc" },
    }),
  ]);
  return { awardedRepairs, quotes, openForQuoting };
}
