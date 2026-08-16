import "server-only";
import { prisma } from "./prisma";

export type ArrearsAlert = {
  leaseId: string;
  tenantId: string;
  tenant: string;
  phone: string | null;
  email: string | null;
  property: string;
  unit: string;
  balance: number;
  monthlyRent: number;
  /** How many months of rent the debt represents. */
  monthsOfRent: number;
  /** UTC month-start of the oldest charge still not covered by a payment. */
  oldestUnpaidPeriod: Date | null;
  /** Whole months between that charge's period and now. */
  monthsOverdue: number;
  reasons: string[];
  severity: "watch" | "serious";
};

const MONTHS_BEHIND_LIMIT = 2;
const RENT_MULTIPLE_LIMIT = 2;

function monthsBetween(from: Date, to: Date) {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
}

/**
 * Tenants who owe two months' rent or more, or whose oldest unpaid charge
 * has been outstanding beyond two months — the same two escalation rules
 * the reference build (HM Kariuki Trust) uses.
 *
 * Age is worked out by settling payments against charges oldest-first, so
 * "two months behind" means the debt is genuinely old, not that one large
 * recent charge happens to exceed two months' rent.
 */
export async function getArrearsAlerts(organizationId: string, now = new Date()): Promise<ArrearsAlert[]> {
  const leases = await prisma.lease.findMany({
    where: { organizationId, status: "ACTIVE" },
    include: {
      charges: { orderBy: { periodMonth: "asc" } },
      payments: true,
      tenant: true,
      unit: { include: { property: true } },
    },
  });

  const alerts: ArrearsAlert[] = [];

  for (const l of leases) {
    const charged = l.charges.reduce((s, c) => s + c.amount, 0);
    const paid = l.payments.reduce((s, p) => s + p.amount, 0);
    const balance = charged - paid;
    if (balance <= 0.5) continue;

    // Settle payments against charges oldest-first to find what is still open.
    let pot = paid;
    let oldestUnpaid: (typeof l.charges)[number] | null = null;
    for (const c of l.charges) {
      if (pot >= c.amount) {
        pot -= c.amount;
        continue;
      }
      oldestUnpaid = c; // first charge the money did not stretch to
      break;
    }

    const monthsOverdue = oldestUnpaid ? monthsBetween(oldestUnpaid.periodMonth, now) : 0;
    const monthsOfRent = l.monthlyRent > 0 ? balance / l.monthlyRent : 0;

    const reasons: string[] = [];
    if (monthsOfRent >= RENT_MULTIPLE_LIMIT) reasons.push(`owes ${monthsOfRent.toFixed(1)}× the monthly rent`);
    if (monthsOverdue >= MONTHS_BEHIND_LIMIT) reasons.push(`oldest unpaid charge is ${monthsOverdue} months old`);
    if (reasons.length === 0) continue;

    alerts.push({
      leaseId: l.id,
      tenantId: l.tenantId,
      tenant: l.tenant.name,
      phone: l.tenant.phone,
      email: l.tenant.email,
      property: l.unit.property.name,
      unit: l.unit.label,
      balance,
      monthlyRent: l.monthlyRent,
      monthsOfRent,
      oldestUnpaidPeriod: oldestUnpaid?.periodMonth ?? null,
      monthsOverdue,
      reasons,
      // Both rules tripping, or a debt beyond three months, is the serious end.
      severity: reasons.length > 1 || monthsOverdue >= 3 ? "serious" : "watch",
    });
  }

  return alerts.sort((a, b) => b.balance - a.balance);
}
