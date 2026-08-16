import "server-only";
import { prisma } from "./prisma";

/**
 * The monthly rent-charge run — working out which active leases still need
 * this month's RENT charge, without writing anything until staff approve it.
 * Only rent is raised automatically; utility/deposit charges stay a manual,
 * per-lease action since there's no per-service history here to carry
 * forward the way there would be for a landlord billing several line items
 * a month.
 */

export type DraftRow = {
  leaseId: string;
  tenant: string;
  property: string;
  unit: string;
  amount: number;
};

export type BillingDraft = {
  period: string; // "2026-08"
  rows: DraftRow[];
  total: number;
  skipped: { tenant: string; unit: string; reason: string }[];
};

function monthStart(period: string): Date {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}
function monthEnd(period: string): Date {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
}

export async function previewBilling(organizationId: string, period: string): Promise<BillingDraft> {
  const start = monthStart(period);
  const end = monthEnd(period);

  const leases = await prisma.lease.findMany({
    where: { organizationId, status: "ACTIVE" },
    include: {
      tenant: { select: { name: true } },
      unit: { select: { label: true, property: { select: { name: true } } } },
    },
  });

  const alreadyBilled = new Set(
    (
      await prisma.charge.findMany({
        where: { organizationId, type: "RENT", periodMonth: start, leaseId: { in: leases.map((l) => l.id) } },
        select: { leaseId: true },
      })
    ).map((c) => c.leaseId),
  );

  const rows: DraftRow[] = [];
  const skipped: BillingDraft["skipped"] = [];

  for (const l of leases) {
    const where = { tenant: l.tenant.name, unit: `${l.unit.property.name} ${l.unit.label}` };
    if (l.startDate > end) {
      skipped.push({ ...where, reason: "tenancy starts after this month" });
      continue;
    }
    if (l.endDate && l.endDate < start) {
      skipped.push({ ...where, reason: "tenancy ended before this month" });
      continue;
    }
    if (l.monthlyRent <= 0) {
      skipped.push({ ...where, reason: "no rent recorded on the lease" });
      continue;
    }
    if (alreadyBilled.has(l.id)) continue; // fully billed already — not worth mentioning

    rows.push({ leaseId: l.id, tenant: l.tenant.name, property: l.unit.property.name, unit: l.unit.label, amount: l.monthlyRent });
  }

  rows.sort((a, b) => a.property.localeCompare(b.property) || a.unit.localeCompare(b.unit, undefined, { numeric: true }));

  return { period, rows, total: rows.reduce((s, r) => s + r.amount, 0), skipped };
}

/**
 * Raises an approved month's rent charges. Recomputed from scratch here
 * rather than trusted from the form, so what's written is exactly what the
 * rules produce right now — pressing the button twice, or a run that gets
 * interrupted halfway, never double-bills anyone; a repeat run just fills
 * whatever is still missing.
 */
export async function applyBilling(organizationId: string, period: string): Promise<{ leases: number; charges: number }> {
  const draft = await previewBilling(organizationId, period);
  if (draft.rows.length === 0) return { leases: 0, charges: 0 };

  const periodMonth = monthStart(period);
  const data = draft.rows.map((r) => ({
    organizationId,
    leaseId: r.leaseId,
    type: "RENT",
    description: `Rent ${period}`,
    amount: r.amount,
    periodMonth,
  }));

  // Batched rather than one big transaction — a hosted database reached over
  // HTTP (Turso in production) is a poor fit for a single long-lived
  // transaction across many rows; small batches keep each round trip quick.
  let written = 0;
  for (let i = 0; i < data.length; i += 40) {
    const batch = data.slice(i, i + 40);
    await prisma.charge.createMany({ data: batch });
    written += batch.length;
  }

  return { leases: draft.rows.length, charges: written };
}
