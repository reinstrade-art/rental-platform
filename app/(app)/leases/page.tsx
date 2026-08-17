import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getLeases, leaseBalance } from "@/app/lib/data";
import { prisma } from "@/app/lib/prisma";
import { deleteLease, importRentRoll } from "@/app/lib/actions";
import { DeleteButton } from "@/app/components/delete-button";
import { getOrgTier, hasFeature } from "@/app/lib/tier";

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default async function LeasesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  const tier = await getOrgTier(s.organizationId);
  const canImport = hasFeature(tier, "CSV_IMPORT");
  const canBillingRun = hasFeature(tier, "BILLING_RUN");
  const { error } = await searchParams;
  const [leases, properties] = await Promise.all([
    getLeases(s.organizationId),
    prisma.property.findMany({ where: { organizationId: s.organizationId }, orderBy: { name: "asc" } }),
  ]);

  const withBalances = await Promise.all(
    leases.map(async (l) => {
      const [charges, payments] = await Promise.all([
        prisma.charge.findMany({ where: { leaseId: l.id }, select: { amount: true } }),
        prisma.payment.findMany({ where: { leaseId: l.id }, select: { amount: true } }),
      ]);
      return { ...l, balance: leaseBalance({ charges, payments }) };
    }),
  );

  return (
    <div className="flex flex-col gap-8">
      {error && <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Leases</h1>
        <div className="flex items-center gap-3">
          {canBillingRun && (
            <Link href="/leases/billing-run" className="rounded border px-3 py-1.5 text-sm transition-colors hover:bg-silver-light">
              Monthly billing run
            </Link>
          )}
          <Link href="/leases/new" className="rounded bg-ink px-3 py-1.5 text-sm text-lily transition-colors hover:bg-ink-soft">
            Add lease
          </Link>
        </div>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
            <th className="py-2">Tenant</th>
            <th className="py-2">Unit</th>
            <th className="py-2">Monthly rent</th>
            <th className="py-2">Status</th>
            <th className="py-2">Balance</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {withBalances.map((l) => (
            <tr key={l.id} className="border-b">
              <td className="py-2">
                <Link href={`/leases/${l.id}`} className="underline">
                  {l.tenant.name}
                </Link>
              </td>
              <td className="py-2">
                {l.unit.property.name} / {l.unit.label}
              </td>
              <td className="py-2">{money(l.monthlyRent)}</td>
              <td className="py-2">{l.status}</td>
              <td className={`py-2 ${l.balance > 0 ? "text-red-600" : ""}`}>{money(l.balance)}</td>
              <td className="py-2">
                <div className="flex items-center justify-end gap-3">
                  <Link href={`/leases/${l.id}/edit`} className="text-xs underline text-silver-dark">
                    Edit
                  </Link>
                  <form action={deleteLease.bind(null, l.id)}>
                    <DeleteButton confirmText={`Delete the lease for ${l.tenant.name} (${l.unit.property.name} / ${l.unit.label})? This cannot be undone.`} />
                  </form>
                </div>
              </td>
            </tr>
          ))}
          {withBalances.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-silver-dark">
                No leases yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {canImport && (
        <div className="max-w-sm">
          <h2 className="font-semibold">Import a rent roll</h2>
          <p className="text-xs text-silver-dark">
            Select the property this file belongs to, then upload a CSV with a header row like: Unit #, Tenant, Month,
            Year, Expected Rent, Billed Rent, RENT Paid. Units, tenants, and leases are created or matched
            automatically, and each period&apos;s charge/payment is recorded — a &quot;VACANT&quot; tenant just creates the
            unit. Three more columns are read if present — a Deposit column (raised once per lease, not every
            month), a Water column, and a Garbage/Hygiene fee column (both billed every period, same as rent) —
            each simply skipped if your file doesn&apos;t have it.
          </p>
          <form action={importRentRoll} className="mt-3 flex flex-col gap-2" encType="multipart/form-data">
            <select name="propertyId" required className="rounded border px-3 py-2 text-sm">
              <option value="">Select property</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input name="file" type="file" accept=".csv,text/csv" required className="rounded border px-3 py-2 text-sm" />
            <button type="submit" className="rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
              Import
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
