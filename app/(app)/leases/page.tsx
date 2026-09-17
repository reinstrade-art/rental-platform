import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireStaff, canViewTenantPII } from "@/app/lib/auth";
import { maskTenantName } from "@/app/lib/tenant-privacy";
import { leaseBalance } from "@/app/lib/data";
import { prisma } from "@/app/lib/prisma";
import { deleteLease, importRentRoll } from "@/app/lib/actions";
import { DeleteButton } from "@/app/components/delete-button";
import { getOrgTier, hasFeature } from "@/app/lib/tier";
import { MonthNav } from "@/app/components/month-nav";
import { displayBalance, balanceTone } from "@/app/lib/balance-display";
import { requireModule } from "@/app/lib/permissions";

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default async function LeasesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; period?: string }>;
}) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  requireModule(s, "leases");
  const piiVisible = canViewTenantPII(s.role);
  const tier = await getOrgTier(s.organizationId);
  const canImport = hasFeature(tier, "CSV_IMPORT");
  const canBillingRun = hasFeature(tier, "BILLING_RUN");
  const { error, period: periodParam } = await searchParams;

  const now = new Date();
  const period = /^\d{4}-\d{2}$/.test(periodParam ?? "")
    ? periodParam!
    : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const [periodYear, periodMonth] = period.split("-").map(Number);
  const periodStart = new Date(Date.UTC(periodYear, periodMonth - 1, 1));
  const periodEnd = new Date(Date.UTC(periodYear, periodMonth, 1));
  const periodLabel = `${MONTH_NAMES[periodMonth - 1]} ${periodYear}`;

  const properties = await prisma.property.findMany({
    where: { organizationId: s.organizationId },
    include: {
      units: {
        orderBy: { label: "asc" },
        include: { leases: { include: { tenant: true, charges: true, payments: true } } },
      },
    },
    orderBy: { name: "asc" },
  });

  const grouped = properties.map((p) => {
    const rows = p.units.map((u) => {
      // The one lease (if any) actually covering this unit during the
      // selected month — not just "the current lease", so a past or future
      // month correctly shows who was there then, not who's there today.
      const lease = u.leases.find((l) => l.startDate < periodEnd && (!l.endDate || l.endDate >= periodStart));
      if (!lease) return { unit: u, lease: null as null };
      const periodCharged = lease.charges
        .filter((c) => c.periodMonth >= periodStart && c.periodMonth < periodEnd)
        .reduce((sum, c) => sum + c.amount, 0);
      const periodPaid = lease.payments
        .filter((pm) => pm.paidAt >= periodStart && pm.paidAt < periodEnd)
        .reduce((sum, pm) => sum + pm.amount, 0);
      return { unit: u, lease, periodCharged, periodPaid, balance: leaseBalance(lease) };
    });
    return { property: p, rows };
  });

  const allRows = grouped.flatMap((g) => g.rows);
  const occupiedRows = allRows.filter((r) => r.lease);
  const activeLeaseCount = allRows.filter((r) => r.lease?.status === "ACTIVE").length;
  // What the portfolio would earn TODAY at full occupancy — deliberately the
  // unit's CURRENT lease, not whichever lease covered the month being viewed
  // above, so this stays a stable benchmark instead of swinging with a past
  // tenant's rent. A vacant unit's own listed rent counts too.
  const currentRent = (r: (typeof allRows)[number]) => {
    const current = r.unit.leases.find((l) => l.status === "ACTIVE");
    return current ? current.monthlyRent : (r.unit.monthlyRent ?? 0);
  };
  const summary = {
    units: allRows.length,
    occupied: occupiedRows.length,
    vacant: allRows.length - occupiedRows.length,
    expectedRent: allRows.reduce((sum, r) => sum + currentRent(r), 0),
    charged: occupiedRows.reduce((sum, r) => sum + (r.periodCharged ?? 0), 0),
    paid: occupiedRows.reduce((sum, r) => sum + (r.periodPaid ?? 0), 0),
    arrears: occupiedRows.reduce((sum, r) => sum + Math.max(0, r.balance ?? 0), 0),
  };
  const collectionRate = summary.charged > 0 ? Math.round((summary.paid / summary.charged) * 100) : 0;
  const tiles = [
    { label: "Expected", value: money(summary.expectedRent), sub: periodLabel },
    { label: "Collected", value: money(summary.paid), sub: `${collectionRate}% of expected` },
    { label: "Arrears", value: money(summary.arrears), sub: "Owed across all leases, as of today", tone: summary.arrears > 0 ? "text-red-600" : "text-green-700" },
    { label: "Properties", value: String(properties.length), sub: `${activeLeaseCount} active leases` },
  ];

  const propertyCards = grouped.map(({ property, rows }) => {
    const occ = rows.filter((r) => r.lease);
    return {
      property,
      totalUnits: rows.length,
      occupied: occ.length,
      expected: rows.reduce((sum, r) => sum + currentRent(r), 0),
      collected: occ.reduce((sum, r) => sum + (r.periodPaid ?? 0), 0),
      arrears: occ.reduce((sum, r) => sum + Math.max(0, r.balance ?? 0), 0),
    };
  });

  return (
    <div className="flex flex-col gap-8">
      {error && <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold uppercase tracking-wide">Leases &amp; Rent</h1>
          <p className="mt-1 text-sm text-silver-dark">Active agreements, balances and rent tracking — {periodLabel}</p>
        </div>
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

      <MonthNav basePath="/leases" period={period} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded border p-4">
            <div className="text-xs uppercase tracking-wide text-silver-dark">{t.label}</div>
            <div className={`mt-1 text-xl font-semibold ${"tone" in t ? t.tone : ""}`}>{t.value}</div>
            {t.sub && <div className="mt-1 text-xs text-silver-dark">{t.sub}</div>}
          </div>
        ))}
      </div>

      {propertyCards.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-silver-dark">By property · {periodLabel}</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {propertyCards.map((c) => (
              <Link
                key={c.property.id}
                href={`/properties/${c.property.id}`}
                className="rounded border p-4 transition-colors hover:border-t-2 hover:border-t-gold hover:bg-silver-light"
              >
                <div className="font-semibold">{c.property.name}</div>
                <div className="mt-1 text-xs text-silver-dark">
                  {c.occupied} of {c.totalUnits} units let
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-silver-dark">Expected</div>
                    <div className="tabular-nums">{money(c.expected)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-silver-dark">Collected</div>
                    <div className="tabular-nums">{money(c.collected)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-silver-dark">Arrears</div>
                    <div className={`tabular-nums ${c.arrears > 0 ? "text-red-600" : "text-green-700"}`}>{money(c.arrears)}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <h2 className="text-xs font-semibold uppercase tracking-wide text-silver-dark">All units · {periodLabel}</h2>

      {grouped.map(({ property, rows }) => (
        <div key={property.id}>
          <h2 className="font-semibold">{property.name}</h2>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
                <th className="py-2">Unit</th>
                <th className="py-2">Tenant</th>
                <th className="py-2">Monthly rent</th>
                <th className="py-2">Charged ({MONTH_NAMES[periodMonth - 1]})</th>
                <th className="py-2">Paid ({MONTH_NAMES[periodMonth - 1]})</th>
                <th className="py-2">Balance (all-time)</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) =>
                r.lease ? (
                  <tr key={r.unit.id} className="border-b">
                    <td className="py-2">{r.unit.label}</td>
                    <td className="py-2">
                      <Link href={`/leases/${r.lease.id}`} className="underline">
                        {maskTenantName(r.lease.tenant.name, piiVisible)}
                      </Link>
                    </td>
                    <td className="py-2">{money(r.lease.monthlyRent)}</td>
                    <td className="py-2">{money(r.periodCharged)}</td>
                    <td className="py-2">{money(r.periodPaid)}</td>
                    <td className={`py-2 ${balanceTone(r.balance ?? 0)}`}>{money(displayBalance(r.balance ?? 0))}</td>
                    <td className="py-2">
                      <div className="flex items-center justify-end gap-3">
                        <Link href={`/leases/${r.lease.id}/edit`} className="text-xs underline text-silver-dark">
                          Edit
                        </Link>
                        <form action={deleteLease.bind(null, r.lease.id)}>
                          <DeleteButton
                            confirmText={`Delete the lease for ${maskTenantName(r.lease.tenant.name, piiVisible)} (${property.name} / ${r.unit.label})? This cannot be undone.`}
                          />
                        </form>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.unit.id} className="border-b bg-silver-light/40">
                    <td className="py-2">{r.unit.label}</td>
                    <td className="py-2 italic text-silver-dark">Vacant</td>
                    <td className="py-2 text-silver-dark">{money(r.unit.monthlyRent ?? 0)}</td>
                    <td className="py-2 text-silver-dark" colSpan={3}>
                      —
                    </td>
                    <td className="py-2 text-right">
                      <Link href={`/leases/new?unitId=${r.unit.id}`} className="text-xs underline">
                        Add lease
                      </Link>
                    </td>
                  </tr>
                ),
              )}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-silver-dark">
                    No units yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ))}
      {grouped.length === 0 && <p className="text-sm text-silver-dark">No properties yet.</p>}

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
