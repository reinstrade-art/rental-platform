import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getTransactions, getLeases } from "@/app/lib/data";
import { addManualTransaction, importTransactionsCsv, matchTransactionAction, ignoreTransactionAction } from "@/app/lib/actions";

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

const STATUS_COLOR: Record<string, string> = {
  UNMATCHED: "text-orange-600",
  MATCHED: "text-green-700",
  IGNORED: "text-silver-dark",
};

export default async function PaymentsPage() {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");

  const [transactions, leases] = await Promise.all([getTransactions(s.organizationId), getLeases(s.organizationId)]);
  const unmatched = transactions.filter((t) => t.status === "UNMATCHED");

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold">Payments ingestion</h1>
        <p className="text-sm text-silver-dark">
          Every transaction — however it arrives — lands here first and either auto-matches by a unit's payment
          code or waits for a manual match. Nothing is guessed silently.
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <div className="max-w-sm">
          <h2 className="font-semibold">Log a transaction manually</h2>
          <p className="text-xs text-silver-dark">E.g. from a bank SMS or M-Pesa message you read yourself.</p>
          <form action={addManualTransaction} className="mt-3 flex flex-col gap-2">
            <input name="occurredAt" type="date" required className="rounded border px-3 py-2" />
            <input name="amount" type="number" step="0.01" required placeholder="Amount" className="rounded border px-3 py-2" />
            <input name="reference" placeholder="Reference / account number" className="rounded border px-3 py-2" />
            <input name="payerName" placeholder="Payer name (optional)" className="rounded border px-3 py-2" />
            <button type="submit" className="rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
              Add transaction
            </button>
          </form>
        </div>

        <div className="max-w-sm">
          <h2 className="font-semibold">Import a CSV</h2>
          <p className="text-xs text-silver-dark">One row per transaction: date,amount,reference,payer</p>
          <form action={importTransactionsCsv} className="mt-3 flex flex-col gap-2" encType="multipart/form-data">
            <input name="file" type="file" accept=".csv,text/csv" required className="rounded border px-3 py-2 text-sm" />
            <button type="submit" className="rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
              Import
            </button>
          </form>
        </div>
      </div>

      <div>
        <h2 className="font-semibold">Unmatched ({unmatched.length})</h2>
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
              <th className="py-1">Date</th>
              <th className="py-1">Amount</th>
              <th className="py-1">Reference</th>
              <th className="py-1">Payer</th>
              <th className="py-1">Source</th>
              <th className="py-1">Match to lease</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {unmatched.map((t) => (
              <tr key={t.id} className="border-b">
                <td className="py-1">{new Date(t.occurredAt).toLocaleDateString()}</td>
                <td className="py-1">{money(t.amount)}</td>
                <td className="py-1">{t.reference ?? "—"}</td>
                <td className="py-1">{t.payerName ?? "—"}</td>
                <td className="py-1">{t.source}</td>
                <td className="py-1">
                  <form action={matchTransactionAction.bind(null, t.id)} className="flex gap-2">
                    <select name="leaseId" required className="rounded border px-2 py-1 text-xs">
                      <option value="">Select lease</option>
                      {leases.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.tenant.name} — {l.unit.property.name}/{l.unit.label}
                        </option>
                      ))}
                    </select>
                    <button className="text-xs underline">Match</button>
                  </form>
                </td>
                <td className="py-1">
                  <form action={ignoreTransactionAction.bind(null, t.id)}>
                    <button className="text-xs underline text-silver-dark">Ignore</button>
                  </form>
                </td>
              </tr>
            ))}
            {unmatched.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-silver-dark">
                  Nothing waiting on a match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="font-semibold">All transactions</h2>
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
              <th className="py-1">Date</th>
              <th className="py-1">Amount</th>
              <th className="py-1">Reference</th>
              <th className="py-1">Source</th>
              <th className="py-1">Status</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.id} className="border-b">
                <td className="py-1">{new Date(t.occurredAt).toLocaleDateString()}</td>
                <td className="py-1">{money(t.amount)}</td>
                <td className="py-1">{t.reference ?? "—"}</td>
                <td className="py-1">{t.source}</td>
                <td className={`py-1 ${STATUS_COLOR[t.status] ?? ""}`}>
                  {t.status}
                  {t.status === "MATCHED" && !t.matchedBy ? " (auto)" : ""}
                </td>
              </tr>
            ))}
            {transactions.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-silver-dark">
                  No transactions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
