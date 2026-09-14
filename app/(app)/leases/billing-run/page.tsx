import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { requireModule } from "@/app/lib/permissions";
import { previewBilling } from "@/app/lib/billing";
import { runMonthlyBilling } from "@/app/lib/actions";
import { getOrgTier, hasFeature } from "@/app/lib/tier";

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function monthLabel(period: string) {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { year: "numeric", month: "long", timeZone: "UTC" });
}

export default async function BillingRunPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; billed?: string; leases?: string; charges?: string; error?: string }>;
}) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  if (!hasFeature(await getOrgTier(s.organizationId), "BILLING_RUN")) redirect("/home");
  requireModule(s, "leases");

  const sp = await searchParams;
  const period = /^\d{4}-\d{2}$/.test(sp.period ?? "") ? sp.period! : new Date().toISOString().slice(0, 7);
  const draft = await previewBilling(s.organizationId, period);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/leases" className="text-xs underline text-silver-dark">
          All leases
        </Link>
        <h1 className="mt-1 text-lg font-semibold">Monthly billing run — {monthLabel(period)}</h1>
        <p className="text-sm text-silver-dark">
          Raises this month&apos;s rent charge for every active lease that doesn&apos;t already have one. Nothing is
          charged until you press the button below, and pressing it twice — or re-running after a partial run — is
          safe: anything already billed is passed over.
        </p>
      </div>

      {sp.error && <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{sp.error}</div>}

      {sp.billed === "ok" && (
        <div className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
          Raised {sp.charges} charge{sp.charges === "1" ? "" : "s"} across {sp.leases} lease{sp.leases === "1" ? "" : "s"}.
        </div>
      )}

      <form method="GET" className="flex items-end gap-2">
        <label className="text-xs text-silver-dark">
          Month
          <input type="month" name="period" defaultValue={period} className="mt-1 block rounded border px-3 py-2 text-sm" />
        </label>
        <button type="submit" className="rounded border px-3 py-2 text-sm transition-colors hover:bg-silver-light">
          Preview
        </button>
      </form>

      {draft.rows.length === 0 ? (
        <p className="text-sm text-silver-dark">Every active lease is already billed for {monthLabel(period)}.</p>
      ) : (
        <>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
                <th className="py-2">Tenant</th>
                <th className="py-2">Unit</th>
                <th className="py-2">Rent</th>
              </tr>
            </thead>
            <tbody>
              {draft.rows.map((r) => (
                <tr key={r.leaseId} className="border-b">
                  <td className="py-2">
                    <Link href={`/leases/${r.leaseId}`} className="underline">
                      {r.tenant}
                    </Link>
                  </td>
                  <td className="py-2">
                    {r.property} / {r.unit}
                  </td>
                  <td className="py-2">{money(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <form action={runMonthlyBilling} className="max-w-sm">
            <input type="hidden" name="period" value={period} />
            <button type="submit" className="rounded bg-ink px-4 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
              Raise {money(draft.total)} across {draft.rows.length} lease{draft.rows.length === 1 ? "" : "s"}
            </button>
          </form>
        </>
      )}

      {draft.skipped.length > 0 && (
        <details className="text-xs text-silver-dark">
          <summary className="cursor-pointer">{draft.skipped.length} lease{draft.skipped.length === 1 ? "" : "s"} left out</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {draft.skipped.map((sk, i) => (
              <li key={i}>
                {sk.tenant} · {sk.unit} — {sk.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
