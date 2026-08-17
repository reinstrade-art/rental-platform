import "server-only";
import { prisma } from "./prisma";

/**
 * Every figure the monthly performance report prints, built from one pass
 * over the year's leases/charges/payments plus one pass over expenses — so
 * every section of the report is guaranteed to agree with every other, the
 * same discipline the reference build's version follows.
 *
 * Sign convention: arrears/net figures are NEGATIVE when money is owed,
 * POSITIVE when in credit.
 */

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const monthName = (m: number) => MONTH_NAMES[m];

export type MonthFigure = { month: number; name: string; short: string; value: number };

export type TenantStanding = {
  tenant: string;
  unit: string;
  property: string;
  arrears: number; // negative = owes
  billed: number;
  paid: number;
  monthsBilled: number;
  monthsPaidInFull: number;
  consistency: number; // percent of billed months settled in full
};

export type ReportData = {
  year: number;
  through: number; // 0-based index of the last month covered
  propertyName: string | null;
  periodLabel: string;
  focusName: string;

  ytdIncome: number;
  focusIncome: number;
  ytdNetArrears: number;
  focusNetArrears: number;
  totalShortfall: number;

  incomeByMonth: MonthFigure[];
  arrearsByMonth: MonthFigure[];

  worstPayers: TenantStanding[];
  bestPayers: TenantStanding[];

  expensesTotal: number;
  netCash: number;

  gauges: {
    collectionRate: number;
    occupancy: number;
    totalUnits: number;
    occupiedUnits: number;
  };
};

const isBillable = (type: string) => type !== "DEPOSIT";

export async function getReportData(
  organizationId: string,
  year: number,
  through: number,
  propertyId?: string,
): Promise<ReportData> {
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year, through + 1, 1));
  const unitWhere = propertyId ? { propertyId } : {};

  const [leases, property, expenses, units] = await Promise.all([
    prisma.lease.findMany({
      where: { organizationId, unit: unitWhere },
      include: {
        tenant: { select: { name: true } },
        unit: { select: { label: true, property: { select: { name: true } } } },
        charges: { select: { amount: true, type: true, periodMonth: true } },
        payments: { select: { amount: true, paidAt: true } },
      },
    }),
    propertyId ? prisma.property.findFirst({ where: { id: propertyId, organizationId }, select: { name: true } }) : Promise.resolve(null),
    prisma.expense.aggregate({
      where: { organizationId, paidAt: { gte: from, lt: to }, ...(propertyId ? { propertyId } : {}) },
      _sum: { amount: true },
    }),
    prisma.unit.findMany({ where: { organizationId, ...unitWhere }, select: { id: true, leases: { select: { status: true } } } }),
  ]);

  const chargeMonth = (periodMonth: Date) => (periodMonth.getUTCFullYear() === year ? periodMonth.getUTCMonth() : -1);

  const income = Array<number>(12).fill(0);
  const billed = Array<number>(12).fill(0);
  for (const l of leases) {
    for (const c of l.charges) {
      if (!isBillable(c.type)) continue;
      const m = chargeMonth(c.periodMonth);
      if (m >= 0 && m <= through) billed[m] += c.amount;
    }
    for (const p of l.payments) {
      if (p.paidAt >= from && p.paidAt < to) income[p.paidAt.getUTCMonth()] += p.amount;
    }
  }

  const months = Array.from({ length: through + 1 }, (_, m) => m);
  const incomeByMonth: MonthFigure[] = months.map((m) => ({ month: m, name: MONTH_NAMES[m], short: MONTH_NAMES[m].slice(0, 3), value: income[m] }));
  const arrearsByMonth: MonthFigure[] = months.map((m) => ({ month: m, name: MONTH_NAMES[m], short: MONTH_NAMES[m].slice(0, 3), value: income[m] - billed[m] }));

  const ytdIncome = incomeByMonth.reduce((s, r) => s + r.value, 0);
  const ytdNetArrears = arrearsByMonth.reduce((s, r) => s + r.value, 0);
  const totalShortfall = arrearsByMonth.reduce((s, r) => s + (r.value < 0 ? -r.value : 0), 0);

  // --- tenant standing over the whole period --------------------------------
  const standing: TenantStanding[] = leases
    .map((l) => {
      const inPeriod = (m: number) => m >= 0 && m <= through;
      const billedMonths = new Map<number, number>();
      for (const c of l.charges) {
        if (!isBillable(c.type)) continue;
        const m = chargeMonth(c.periodMonth);
        if (inPeriod(m)) billedMonths.set(m, (billedMonths.get(m) ?? 0) + c.amount);
      }
      const paidMonths = new Map<number, number>();
      for (const p of l.payments) {
        if (p.paidAt >= from && p.paidAt < to) {
          const m = p.paidAt.getUTCMonth();
          paidMonths.set(m, (paidMonths.get(m) ?? 0) + p.amount);
        }
      }
      const billedTotal = [...billedMonths.values()].reduce((s, v) => s + v, 0);
      const paidTotal = [...paidMonths.values()].reduce((s, v) => s + v, 0);
      const monthsBilled = billedMonths.size;
      const monthsPaidInFull = [...billedMonths.entries()].filter(([m, amt]) => (paidMonths.get(m) ?? 0) >= amt - 0.5).length;
      return {
        tenant: l.tenant.name,
        unit: l.unit.label,
        property: l.unit.property.name,
        arrears: paidTotal - billedTotal,
        billed: billedTotal,
        paid: paidTotal,
        monthsBilled,
        monthsPaidInFull,
        consistency: monthsBilled ? Math.round((monthsPaidInFull / monthsBilled) * 100) : 0,
      };
    })
    .filter((s) => s.monthsBilled > 0);

  const worstPayers = standing.filter((s) => s.arrears < -0.5).sort((a, b) => a.arrears - b.arrears).slice(0, 10);
  const bestPayers = standing
    .filter((s) => s.arrears >= -0.5)
    .sort((a, b) => b.consistency - a.consistency || b.monthsBilled - a.monthsBilled || b.arrears - a.arrears || a.tenant.localeCompare(b.tenant))
    .slice(0, 10);

  const expensesTotal = expenses._sum.amount ?? 0;
  const occupied = units.filter((u) => u.leases.some((l) => l.status === "ACTIVE")).length;
  const billedTotal = ytdIncome - ytdNetArrears;

  return {
    year,
    through,
    propertyName: property?.name ?? null,
    periodLabel: `1 ${MONTH_NAMES[0]} ${year} – ${new Date(Date.UTC(year, through + 1, 0)).getUTCDate()} ${MONTH_NAMES[through]} ${year}`,
    focusName: MONTH_NAMES[through],
    ytdIncome,
    focusIncome: income[through],
    ytdNetArrears,
    focusNetArrears: arrearsByMonth[through]?.value ?? 0,
    totalShortfall,
    incomeByMonth,
    arrearsByMonth,
    worstPayers,
    bestPayers,
    expensesTotal,
    netCash: ytdIncome - expensesTotal,
    gauges: {
      collectionRate: billedTotal > 0 ? Math.round((ytdIncome / billedTotal) * 100) : 0,
      occupancy: units.length ? Math.round((occupied / units.length) * 100) : 0,
      totalUnits: units.length,
      occupiedUnits: occupied,
    },
  };
}
