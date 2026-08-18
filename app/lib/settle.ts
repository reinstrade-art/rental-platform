/**
 * Working out which billed lines a tenancy's receipts have actually covered.
 *
 * Money usually arrives as one lump against a tenancy — "8,500 by M-Pesa" —
 * with nothing saying which of that month's lines it was for. So whether a
 * given line is paid isn't always something the database records directly;
 * where the office hasn't said, it has to be worked out, and it has to be
 * worked out the same way everywhere or a statement and a balance figure
 * would disagree with each other.
 *
 * A payment can carry allocations — the office saying "1,200 of this is
 * rent, 200 is water" (see PaymentAllocation in schema.prisma, and
 * recordDirectedPayment in actions.ts). Those are applied first, exactly as
 * recorded, because a receipt the office pointed at a line is a statement of
 * fact and must never be overridden by a guess. Whatever of a payment isn't
 * itemized — a fully lump payment has none — falls into the ordinary pool
 * and settles the oldest outstanding charge first. A tenant in arrears who
 * sends money is settling what they owe from the back, not paying this
 * month and leaving a hole behind them — which is also how the running
 * balance on a statement reads.
 */

export type ChargeLike = {
  id: string;
  amount: number;
  periodMonth: Date;
};

export type PaymentLike = {
  id: string;
  amount: number;
  paidAt: Date;
  allocations?: { chargeId: string; amount: number }[];
};

export type Settlement = {
  /** How much of this line the receipts cover. */
  covered: number;
  /** What is still outstanding on it. */
  outstanding: number;
  settled: boolean;
  /** True when some but not all of it is covered. */
  part: boolean;
};

/**
 * Allocates every receipt across every billed line: directed allocations
 * first, then the undirected remainder pooled oldest line first.
 *
 * Returns one entry per charge. Anything left over after all lines are
 * covered is the tenant's credit and simply isn't allocated — it belongs to
 * next month's bill, which doesn't exist yet.
 */
export function allocate(charges: ChargeLike[], payments: PaymentLike[]): Map<string, Settlement> {
  const out = new Map<string, Settlement>();
  const covered = new Map<string, number>();
  for (const c of charges) covered.set(c.id, 0);

  // Pass 1: apply what the office directed explicitly.
  let pool = 0;
  for (const p of payments) {
    const directed = p.allocations?.reduce((sum, a) => sum + a.amount, 0) ?? 0;
    for (const a of p.allocations ?? []) {
      covered.set(a.chargeId, (covered.get(a.chargeId) ?? 0) + a.amount);
    }
    pool += p.amount - directed;
  }

  // Pass 2: pool the undirected remainder across whatever's still short, oldest first.
  const ordered = [...charges].sort((a, b) => a.periodMonth.getTime() - b.periodMonth.getTime());
  for (const c of ordered) {
    const already = covered.get(c.id) ?? 0;
    const short = c.amount - already;
    if (short > 0 && pool > 0) {
      const take = Math.min(short, pool);
      covered.set(c.id, already + take);
      pool -= take;
    }
  }

  for (const c of charges) {
    const cov = covered.get(c.id) ?? 0;
    // A hundredth of a shilling either way is rounding, not a debt.
    const outstanding = Math.max(0, Math.round((c.amount - cov) * 100) / 100);
    out.set(c.id, {
      covered: Math.min(cov, c.amount),
      outstanding,
      settled: outstanding <= 0.005,
      part: cov > 0.005 && outstanding > 0.005,
    });
  }
  return out;
}
