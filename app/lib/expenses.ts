import "server-only";
import { prisma } from "./prisma";

function monthStart(period: string): Date {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}
function monthEndExclusive(period: string): Date {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1));
}

export type CashflowMonth = { period: string; rentIn: number; expensesOut: number; net: number };

/** Rent received vs. expenses paid, month by month, for the trailing `months` months (oldest first). */
export async function getCashflowTrend(organizationId: string, months = 6): Promise<CashflowMonth[]> {
  const now = new Date();
  const periods: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    periods.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }

  const start = monthStart(periods[0]);
  const end = monthEndExclusive(periods[periods.length - 1]);

  const [payments, expenses] = await Promise.all([
    prisma.payment.findMany({ where: { organizationId, paidAt: { gte: start, lt: end } }, select: { amount: true, paidAt: true } }),
    prisma.expense.findMany({ where: { organizationId, paidAt: { gte: start, lt: end } }, select: { amount: true, paidAt: true } }),
  ]);

  const keyOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const rentByMonth = new Map<string, number>();
  for (const p of payments) rentByMonth.set(keyOf(p.paidAt), (rentByMonth.get(keyOf(p.paidAt)) ?? 0) + p.amount);
  const expByMonth = new Map<string, number>();
  for (const e of expenses) expByMonth.set(keyOf(e.paidAt), (expByMonth.get(keyOf(e.paidAt)) ?? 0) + e.amount);

  return periods.map((period) => {
    const rentIn = rentByMonth.get(period) ?? 0;
    const expensesOut = expByMonth.get(period) ?? 0;
    return { period, rentIn, expensesOut, net: rentIn - expensesOut };
  });
}

export type ExpenseWithCategory = { category: string; amount: number };

export function totalByCategory(expenses: ExpenseWithCategory[]) {
  const totals = new Map<string, number>();
  for (const e of expenses) totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount);
  return [...totals.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
}

/**
 * Posts a completed repair's final cost to the expense ledger. Keyed on
 * repairId (unique on Expense), so calling this twice for the same repair
 * corrects the one entry rather than paying for the job a second time.
 */
export async function postRepairExpense(organizationId: string, repairId: string, recordedBy: string) {
  const repair = await prisma.repair.findFirst({ where: { id: repairId, organizationId } });
  if (!repair || repair.status !== "DONE") return;
  const amount = repair.finalCost ?? repair.approvedCost ?? 0;
  if (amount <= 0) return;

  const vendor = repair.awardedVendorId
    ? await prisma.vendor.findUnique({ where: { id: repair.awardedVendorId }, select: { name: true } })
    : null;

  await prisma.expense.upsert({
    where: { repairId },
    create: {
      organizationId,
      propertyId: repair.propertyId,
      category: "REPAIRS",
      amount,
      paidAt: repair.completedAt ?? new Date(),
      description: repair.title,
      payee: vendor?.name ?? null,
      repairId,
      recordedBy,
    },
    update: {
      amount,
      paidAt: repair.completedAt ?? undefined,
      description: repair.title,
      payee: vendor?.name ?? null,
    },
  });
}
