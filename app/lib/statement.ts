import { allocate } from "./settle";
import { CHARGE_TYPE_LABEL } from "./constants";

/**
 * A tenancy statement, grouped into months.
 *
 * Rent is the parent line for a month and utilities/deposits hang beneath
 * it, so the shape of a month reads at a glance: what the tenancy costs,
 * what came in against it. Each month closes with the balance carried into
 * the next, which is the number an argument about arrears actually turns
 * on. Shared by the staff view and the tenant's own portal so the two can
 * never disagree about what is owed.
 */

export type StatementLine = {
  id: string;
  kind: "charge" | "payment";
  date: Date;
  desc: string;
  debit: number;
  credit: number;
  type?: string;
  method?: string | null;
  reference?: string | null;
  outstanding?: number;
  settled?: boolean;
  part?: boolean;
};

export type StatementMonth = {
  key: string; // "2026-03"
  title: string;
  lines: StatementLine[];
  charged: number;
  paid: number;
  /** POSITIVE means the tenant is in credit, NEGATIVE means arrears — the
   *  sign the office reads on paper, opposite of the internal (charged − paid). */
  closing: number;
};

type ChargeLike = { id: string; type: string; description: string | null; amount: number; periodMonth: Date };
type PaymentLike = { id: string; amount: number; method: string | null; reference: string | null; paidAt: Date };

const monthKey = (d: Date) => new Date(d).toISOString().slice(0, 7);
const monthTitle = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { year: "numeric", month: "long" });
};


export function buildStatement(charges: ChargeLike[], payments: PaymentLike[]): StatementMonth[] {
  // One allocation for the whole tenancy, so every month agrees about which lines the money has reached.
  const settled = allocate(charges, payments);
  const months = new Map<string, StatementLine[]>();
  const push = (key: string, line: StatementLine) => {
    const list = months.get(key) ?? [];
    list.push(line);
    months.set(key, list);
  };

  for (const c of charges) {
    push(monthKey(c.periodMonth), {
      id: c.id,
      kind: "charge",
      date: c.periodMonth,
      desc: c.description || CHARGE_TYPE_LABEL[c.type] || c.type,
      debit: c.amount,
      credit: 0,
      type: c.type,
      outstanding: settled.get(c.id)?.outstanding ?? c.amount,
      settled: settled.get(c.id)?.settled ?? false,
      part: settled.get(c.id)?.part ?? false,
    });
  }

  for (const p of payments) {
    push(monthKey(p.paidAt), {
      id: p.id,
      kind: "payment",
      date: p.paidAt,
      desc: `${p.method ?? "Payment"}${p.reference ? ` · ${p.reference}` : ""}`,
      debit: 0,
      credit: p.amount,
      method: p.method,
      reference: p.reference,
    });
  }

  const weight = { charge: 0, payment: 1 } as const;
  let running = 0;
  return [...months.keys()]
    .sort()
    .map((key) => {
      const lines = months.get(key)!.sort((a, b) => weight[a.kind] - weight[b.kind] || a.date.getTime() - b.date.getTime());
      const charged = lines.reduce((s, l) => s + l.debit, 0);
      const paid = lines.reduce((s, l) => s + l.credit, 0);
      running += paid - charged;
      return { key, title: monthTitle(key), lines, charged, paid, closing: running };
    });
}
