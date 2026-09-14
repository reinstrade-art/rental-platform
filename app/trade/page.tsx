import { redirect } from "next/navigation";
import { getSession, requireTradesman } from "@/app/lib/auth";
import { getVendorPortal } from "@/app/lib/data";
import { prisma } from "@/app/lib/prisma";
import { submitQuoteAsTradesman } from "@/app/lib/actions";

const OPEN_STATUSES = ["REPORTED", "QUOTING", "APPROVED", "IN_PROGRESS"];

const PRIORITY_TONE: Record<string, string> = {
  URGENT: "border-red-300 bg-red-50 text-red-700",
  HIGH: "border-orange-300 bg-orange-50 text-orange-700",
  NORMAL: "border-silver bg-silver-light text-ink",
  LOW: "border-silver bg-silver-light text-silver-dark",
};

function money(n: number | null | undefined) {
  return n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border p-4">
      <div className="text-xs uppercase tracking-wide text-silver-dark">{label}</div>
      <div className="mt-1 text-xl font-semibold text-gold">{value}</div>
    </div>
  );
}

export default async function TradePortalPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const s = await getSession();
  if (!requireTradesman(s)) redirect("/login");
  const { error } = await searchParams;

  const [vendor, { awardedRepairs, quotes, openForQuoting }] = await Promise.all([
    prisma.vendor.findUniqueOrThrow({ where: { id: s.vendorId }, select: { name: true, trade: true, prequalified: true, createdAt: true } }),
    getVendorPortal(s.organizationId, s.vendorId),
  ]);

  const open = awardedRepairs.filter((r) => OPEN_STATUSES.includes(r.status));
  const done = awardedRepairs.filter((r) => !OPEN_STATUSES.includes(r.status));
  const valueAwarded = awardedRepairs.reduce((sum, r) => sum + (r.finalCost ?? 0), 0);

  return (
    <div className="flex flex-col gap-8">
      {error && <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold">{vendor.name}</h1>
          <p className="text-xs text-silver-dark">
            {s.role === "CASUAL_LABOURER" ? "Casual labourer" : "Tradesman"}
            {vendor.trade ? ` · ${vendor.trade}` : ""}
          </p>
        </div>
        {vendor.prequalified ? (
          <span className="rounded-full border border-green-300 bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">Cleared for work</span>
        ) : (
          <span className="rounded-full border border-silver bg-silver-light px-2.5 py-0.5 text-xs font-medium text-silver-dark">Awaiting clearance</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Open jobs" value={String(open.length)} />
        <StatCard label="Completed" value={String(done.length)} />
        <StatCard label="Value awarded" value={money(valueAwarded)} />
        <StatCard label="On file since" value={new Date(vendor.createdAt).toLocaleDateString()} />
      </div>

      {!vendor.prequalified && (
        <p className="rounded border border-gold bg-silver-light px-3 py-2 text-sm text-silver-dark">
          Your registration is with the office. You&apos;ll be able to bid on open work once they&apos;ve cleared you.
        </p>
      )}

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-silver-dark">Open for quotes</h2>
        {openForQuoting.length === 0 ? (
          <p className="rounded border p-4 text-sm text-silver-dark">Nothing open for quoting right now.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {openForQuoting.map((r) => (
              <li key={r.id} className="rounded border p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.title}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${PRIORITY_TONE[r.priority] ?? PRIORITY_TONE.NORMAL}`}>{r.priority}</span>
                </div>
                <p className="mt-0.5 text-xs text-silver-dark">
                  {r.property.name}
                  {r.unit ? ` · ${r.unit.label}` : " · common area"}
                </p>
                {r.description && <p className="mt-2 text-sm">{r.description}</p>}
                <form action={submitQuoteAsTradesman.bind(null, r.id)} className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                  <input name="amount" type="number" step="0.01" required placeholder="Your quote" className="w-32 rounded border px-3 py-1.5 text-sm" />
                  <input name="notes" placeholder="Notes (optional)" className="min-w-[10rem] flex-1 rounded border px-3 py-1.5 text-sm" />
                  <button type="submit" className="rounded bg-ink px-3 py-1.5 text-sm text-lily transition-colors hover:bg-ink-soft">
                    Submit quote
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-silver-dark">Jobs awarded to you</h2>
        {awardedRepairs.length === 0 ? (
          <p className="rounded border p-4 text-sm text-silver-dark">When the office allocates work to you, it&apos;ll appear here.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {awardedRepairs.map((r) => (
              <li key={r.id} className="rounded border p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.title}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${PRIORITY_TONE[r.priority] ?? PRIORITY_TONE.NORMAL}`}>{r.priority}</span>
                  <span className={`text-xs ${r.status === "DONE" ? "text-green-700" : "text-silver-dark"}`}>{r.status}</span>
                </div>
                <p className="mt-0.5 text-xs text-silver-dark">
                  {r.property.name}
                  {r.unit ? ` · ${r.unit.label}` : " · common area"} · reported {new Date(r.reportedAt).toLocaleDateString()}
                </p>
                {r.description && <p className="mt-2 text-sm">{r.description}</p>}
                {(r.workOrderRef || r.finalCost != null) && (
                  <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-silver-dark">
                    {r.workOrderRef && (
                      <div className="flex gap-1.5">
                        <dt>Work order</dt>
                        <dd>{r.workOrderRef}</dd>
                      </div>
                    )}
                    {r.finalCost != null && (
                      <div className="flex gap-1.5">
                        <dt>Final cost</dt>
                        <dd>{money(r.finalCost)}</dd>
                      </div>
                    )}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-silver-dark">Your quotes</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
              <th className="py-2">Job</th>
              <th className="py-2">Amount</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => (
              <tr key={q.id} className="border-b">
                <td className="py-2">
                  {q.repair.title} — {q.repair.property.name}
                  {q.repair.unit ? ` / ${q.repair.unit.label}` : ""}
                </td>
                <td className="py-2">{money(q.amount)}</td>
                <td className="py-2">{q.status}</td>
              </tr>
            ))}
            {quotes.length === 0 && (
              <tr>
                <td colSpan={3} className="py-4 text-silver-dark">
                  No quotes submitted yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
