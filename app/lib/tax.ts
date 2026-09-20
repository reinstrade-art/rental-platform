import "server-only";
import { prisma } from "./prisma";

/**
 * Kenya's Monthly Rental Income (MRI) tax, worked out from the ledger.
 *
 * The rules this encodes (KRA, in force since 1 January 2024 — check kra.go.ke
 * before relying on them, tax rules change):
 *   - 7.5% of GROSS rent received, no expenses or losses deducted
 *   - applies to residential rent where gross annual rent is between
 *     KES 288,000 and KES 15,000,000
 *   - the return and payment are due by the 20th of the month AFTER the
 *     rent was received (April's rent → 20 May), filed on KRA's iTax/eRITS
 *
 * What counts as "rent received" is the subtle part. Payments here are often
 * one lump ("KES 14,200 by M-Pesa") covering rent plus water plus an old
 * balance, and a refundable deposit is not rental income. So each payment is
 * split the same way the rest of the app settles it (see settle.ts): amounts
 * the office directed at a specific charge go there, and the undirected
 * remainder settles the oldest open charge first. Only the portion that lands
 * on RENT charges — plus any prepayment beyond everything billed, which is
 * rent paid ahead — is counted, and it is counted in the month the money
 * actually arrived, because MRI is on rent received, not rent billed.
 */

export const MRI_RATE = 0.075;
export const MRI_ANNUAL_MIN = 288_000;
export const MRI_ANNUAL_MAX = 15_000_000;

export type MriMonth = {
  /** "YYYY-MM" — the month the rent was received. */
  period: string;
  label: string;
  grossRent: number;
  mri: number;
  /** The 20th of the following month. */
  dueDate: Date;
};

type ChargeRow = { id: string; type: string; amount: number; periodMonth: Date };
type PaymentRow = { amount: number; paidAt: Date; allocations: { chargeId: string; amount: number }[] };

/**
 * For one lease: how much of each payment was rent. Payments are replayed in
 * date order so a payment can't be attributed to a charge that didn't exist
 * yet — only to what was outstanding when the money came in.
 */
export function rentPortions(charges: ChargeRow[], payments: PaymentRow[]): { paidAt: Date; rent: number }[] {
  const remaining = new Map(charges.map((c) => [c.id, c.amount]));
  const byId = new Map(charges.map((c) => [c.id, c]));
  const ordered = [...charges].sort((a, b) => a.periodMonth.getTime() - b.periodMonth.getTime());

  return [...payments]
    .sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime())
    .map((p) => {
      let rent = 0;
      let directed = 0;
      for (const a of p.allocations) {
        directed += a.amount;
        const c = byId.get(a.chargeId);
        if (!c) continue;
        remaining.set(c.id, Math.max(0, (remaining.get(c.id) ?? 0) - a.amount));
        if (c.type === "RENT") rent += a.amount;
      }
      let pool = p.amount - directed;
      for (const c of ordered) {
        if (pool <= 0) break;
        const open = remaining.get(c.id) ?? 0;
        if (open <= 0) continue;
        const take = Math.min(open, pool);
        remaining.set(c.id, open - take);
        pool -= take;
        if (c.type === "RENT") rent += take;
      }
      // Whatever is left has no charge to settle: rent paid in advance.
      if (pool > 0) rent += pool;
      return { paidAt: p.paidAt, rent };
    });
}

function monthKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The last `months` months (newest first) of gross rent received and the MRI due on it. */
export async function getMriSummary(organizationId: string, months = 12, now = new Date()): Promise<MriMonth[]> {
  const leases = await prisma.lease.findMany({
    where: { organizationId },
    select: {
      charges: { select: { id: true, type: true, amount: true, periodMonth: true } },
      payments: { select: { amount: true, paidAt: true, allocations: { select: { chargeId: true, amount: true } } } },
    },
  });

  const received = new Map<string, number>();
  for (const l of leases) {
    for (const p of rentPortions(l.charges, l.payments)) {
      const k = monthKey(p.paidAt);
      received.set(k, (received.get(k) ?? 0) + p.rent);
    }
  }

  const out: MriMonth[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const period = monthKey(d);
    const grossRent = Math.round((received.get(period) ?? 0) * 100) / 100;
    out.push({
      period,
      label: d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }),
      grossRent,
      mri: Math.round(grossRent * MRI_RATE),
      dueDate: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 20)),
    });
  }
  return out;
}
