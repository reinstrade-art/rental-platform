import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { getCashflowTrend, totalByCategory } from "@/app/lib/expenses";
import { createExpense, deleteExpense } from "@/app/lib/actions";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from "@/app/lib/constants";
import { DeleteButton } from "@/app/components/delete-button";
import { getOrgTier, hasFeature } from "@/app/lib/tier";

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function monthLabel(period: string) {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { year: "numeric", month: "short", timeZone: "UTC" });
}

function label(s: string) {
  return s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  if (!hasFeature(await getOrgTier(s.organizationId), "EXPENSES")) redirect("/dashboard");
  const { error } = await searchParams;

  const [trend, expenses, properties] = await Promise.all([
    getCashflowTrend(s.organizationId, 6),
    prisma.expense.findMany({
      where: { organizationId: s.organizationId },
      include: { property: true },
      orderBy: { paidAt: "desc" },
      take: 100,
    }),
    prisma.property.findMany({ where: { organizationId: s.organizationId }, orderBy: { name: "asc" } }),
  ]);

  const currentMonth = trend[trend.length - 1];
  const byCategory = totalByCategory(
    expenses.filter((e) => e.paidAt.toISOString().slice(0, 7) === currentMonth.period),
  );

  return (
    <div className="flex flex-col gap-8">
      {error && <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div>
        <h1 className="text-lg font-semibold">Expenses</h1>
        <p className="text-sm text-silver-dark">
          The landlord&apos;s own money going out, distinct from tenant charges/payments. Every entry below (except one
          posted automatically from a completed repair) goes through the same approval chain as a repair cost.
        </p>
      </div>

      <div>
        <h2 className="font-semibold">Last 6 months</h2>
        <table className="mt-2 w-full max-w-lg border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
              <th className="py-1">Month</th>
              <th className="py-1">Rent in</th>
              <th className="py-1">Expenses out</th>
              <th className="py-1">Net</th>
            </tr>
          </thead>
          <tbody>
            {trend.map((m) => (
              <tr key={m.period} className="border-b">
                <td className="py-1">{monthLabel(m.period)}</td>
                <td className="py-1">{money(m.rentIn)}</td>
                <td className="py-1">{money(m.expensesOut)}</td>
                <td className={`py-1 ${m.net < 0 ? "text-red-600" : "text-green-700"}`}>{money(m.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {byCategory.length > 0 && (
        <div>
          <h2 className="font-semibold">This month by category</h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {byCategory.map((c) => (
              <li key={c.category}>
                {label(c.category)} — {money(c.amount)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-8 md:grid-cols-2">
        <div>
          <h2 className="font-semibold">Recent expenses</h2>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
                <th className="py-1">Date</th>
                <th className="py-1">Category</th>
                <th className="py-1">Amount</th>
                <th className="py-1"></th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className="border-b">
                  <td className="py-1">{new Date(e.paidAt).toLocaleDateString()}</td>
                  <td className="py-1">
                    {label(e.category)}
                    <span className="block text-xs text-silver-dark">
                      {[e.property?.name, e.payee, e.description].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </td>
                  <td className="py-1">{money(e.amount)}</td>
                  <td className="py-1">
                    {e.repairId ? (
                      <span className="text-xs text-silver-dark">from repair</span>
                    ) : (
                      <form action={deleteExpense.bind(null, e.id)}>
                        <DeleteButton confirmText={`Delete this ${label(e.category)} expense of ${money(e.amount)}?`} />
                      </form>
                    )}
                  </td>
                </tr>
              ))}
              {expenses.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-silver-dark">
                    No expenses recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="max-w-sm">
          <h2 className="font-semibold">Record an expense</h2>
          <p className="text-xs text-silver-dark">
            Submitted for approval rather than recorded immediately — see Approvals once you submit.
          </p>
          <form action={createExpense} className="mt-3 flex flex-col gap-2">
            <select name="category" required className="rounded border px-3 py-2 text-sm">
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {label(c)}
                </option>
              ))}
            </select>
            <input name="amount" type="number" step="0.01" required placeholder="Amount" className="rounded border px-3 py-2 text-sm" />
            <input name="paidAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="rounded border px-3 py-2 text-sm" />
            <input name="description" placeholder="Description" className="rounded border px-3 py-2 text-sm" />
            <input name="payee" placeholder="Paid to (optional)" className="rounded border px-3 py-2 text-sm" />
            <select name="propertyId" className="rounded border px-3 py-2 text-sm">
              <option value="">Whole portfolio</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <select name="method" className="rounded border px-3 py-2 text-sm">
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <input name="reference" placeholder="Reference" className="rounded border px-3 py-2 text-sm" />
            </div>
            <button type="submit" className="rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
              Submit for approval
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
