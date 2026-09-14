import Link from "next/link";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getDashboard, getPropertyRollups, getRepairSummary, monthRange, ytdRange, getBilledVsCollected } from "@/app/lib/data";
import { redirect } from "next/navigation";
import { getOrgTier, hasFeature } from "@/app/lib/tier";
import { prisma } from "@/app/lib/prisma";
import { MonthNav } from "@/app/components/month-nav";
import { Gauge, BilledVsCollected } from "@/app/components/charts";

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");

  const now = new Date();
  const sp = await searchParams;
  const period = /^\d{4}-\d{2}$/.test(sp.period ?? "")
    ? sp.period!
    : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const [year, month] = period.split("-").map(Number);
  const periodDate = new Date(Date.UTC(year, month - 1, 1));
  const range = monthRange(periodDate);
  const periodLabel = `${MONTH_NAMES[month - 1]} ${year}`;

  const [dash, ytdDash, rollups, repairs, tier, properties, billedVsCollected, activeLeaseCount, leasesWithDeposit] =
    await Promise.all([
      getDashboard(s.organizationId, range),
      getDashboard(s.organizationId, ytdRange(year, now)),
      getPropertyRollups(s.organizationId, range),
      getRepairSummary(s.organizationId),
      getOrgTier(s.organizationId),
      prisma.property.findMany({
        where: { organizationId: s.organizationId },
        include: { units: { orderBy: { label: "asc" }, include: { leases: { select: { startDate: true, endDate: true } } } } },
        orderBy: { name: "asc" },
      }),
      getBilledVsCollected(s.organizationId, year),
      prisma.lease.count({ where: { organizationId: s.organizationId, status: "ACTIVE" } }),
      prisma.lease.count({ where: { organizationId: s.organizationId, status: "ACTIVE", charges: { some: { type: "DEPOSIT" } } } }),
    ]);
  const canAlerts = hasFeature(tier, "ARREARS_ALERTS");
  const canRepairs = hasFeature(tier, "REPAIRS");

  // Vacant = no lease covering the selected period at all — same rule the
  // Leases page uses, so "vacant" means the same thing in both places.
  const vacantByProperty = properties
    .map((p) => ({
      property: p,
      units: p.units.filter((u) => !u.leases.some((l) => l.startDate < range.end && (!l.endDate || l.endDate >= range.start))),
    }))
    .filter((g) => g.units.length > 0);

  const collectionRateThisMonth = dash.billed > 0 ? Math.round((dash.received / dash.billed) * 100) : 0;
  const collectionRateYtd = ytdDash.billed > 0 ? Math.round((ytdDash.received / ytdDash.billed) * 100) : 0;
  const occupancyRate = dash.unitCount > 0 ? Math.round((dash.occupiedUnits / dash.unitCount) * 100) : 0;
  const depositsRate = activeLeaseCount > 0 ? Math.round((leasesWithDeposit / activeLeaseCount) * 100) : 0;

  const ytdTiles = [
    { label: "Billed YTD", value: money(ytdDash.billed), sub: `Jan–${MONTH_NAMES[month - 1]} ${year}`, href: "/leases" },
    {
      label: "Received YTD",
      value: money(ytdDash.received),
      sub: `${collectionRateYtd}% collected`,
      tone: collectionRateYtd >= 90 ? "good" : collectionRateYtd >= 75 ? "warn" : "bad",
      href: "/payments",
    },
    {
      label: "Shortfall YTD",
      value: money(ytdDash.billed - ytdDash.received),
      sub: "Billed less received",
      tone: ytdDash.billed - ytdDash.received > 0 ? "bad" : "good",
      href: "/leases",
    },
    { label: "Arrears outstanding", value: money(dash.grossArrears), sub: "All leases, as of today", tone: dash.grossArrears > 0 ? "bad" : "good", href: canAlerts ? "/alerts" : "/leases" },
  ] as const;

  const tiles = [
    { label: "Properties", value: dash.propertyCount, href: "/properties" },
    { label: "Units", value: `${dash.occupiedUnits} / ${dash.unitCount} occupied`, href: "/properties" },
    { label: "Active leases", value: dash.activeLeaseCount, href: "/leases" },
    { label: "Total potential income", value: money(dash.potentialIncome), href: "/properties" },
    { label: `Billed — ${periodLabel}`, value: money(dash.billed), href: "/leases" },
    { label: `Received — ${periodLabel}`, value: money(dash.received), href: "/payments" },
    ...(canRepairs
      ? [
          { label: "Repairs pending", value: `${repairs.pendingCount} (${money(repairs.pendingCost)})`, href: "/repairs" },
          { label: "Repairs done", value: `${repairs.doneCount} (${money(repairs.doneCost)})`, href: "/repairs" },
        ]
      : []),
  ];

  const toneClass: Record<string, string> = { good: "text-green-700", warn: "text-orange-600", bad: "text-red-600" };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <MonthNav basePath="/dashboard" period={period} />
      </div>

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-silver-dark">
          Year to date · January–{MONTH_NAMES[month - 1]} {year}
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {ytdTiles.map((t) => (
            <Link key={t.label} href={t.href} className="rounded border p-4 transition-colors hover:border-t-2 hover:border-t-gold hover:bg-silver-light">
              <div className="text-xs text-silver-dark">{t.label}</div>
              <div className={`mt-1 text-xl font-semibold ${"tone" in t ? toneClass[t.tone] ?? "" : ""}`}>{t.value}</div>
              {"sub" in t && <div className="mt-1 text-xs text-silver-dark">{t.sub}</div>}
            </Link>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-silver-dark">How the portfolio is doing</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
          <Link href="/leases">
            <Gauge label="Rent collected" percent={collectionRateThisMonth} caption={`${money(dash.received)} of ${money(dash.billed)} billed`} good={90} fair={75} />
          </Link>
          <Link href="/properties">
            <Gauge label="Occupancy" percent={occupancyRate} caption={`${dash.occupiedUnits} of ${dash.unitCount} units let`} good={95} fair={85} />
          </Link>
          <Link href="/leases">
            <Gauge label="Deposits on file" percent={depositsRate} caption={`${leasesWithDeposit} of ${activeLeaseCount} leases`} good={90} fair={50} />
          </Link>
        </div>
      </div>

      <Link href="/leases">
        <BilledVsCollected data={billedVsCollected} />
      </Link>

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-silver-dark">{periodLabel}</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
          {tiles.map((t) => (
            <Link
              key={t.label}
              href={t.href}
              className="rounded border p-4 transition-colors hover:border-t-2 hover:border-t-gold hover:bg-silver-light"
            >
              <div className="text-xs text-silver-dark">{t.label}</div>
              <div className="mt-1 text-xl font-semibold">{t.value}</div>
            </Link>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold">By property — {periodLabel}</h2>
        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
              <th className="py-2">Property</th>
              <th className="py-2">Units</th>
              <th className="py-2">Occupied</th>
              <th className="py-2">Billed</th>
              <th className="py-2">Received</th>
            </tr>
          </thead>
          <tbody>
            {rollups.map((p) => (
              <tr key={p.id} className="border-b hover:bg-silver-light">
                <td className="py-2">
                  <Link href={`/properties/${p.id}`} className="underline">
                    {p.name}
                  </Link>
                </td>
                <td className="py-2">{p.unitCount}</td>
                <td className="py-2">{p.occupied}</td>
                <td className="py-2">{money(p.billed)}</td>
                <td className="py-2">{money(p.received)}</td>
              </tr>
            ))}
            {rollups.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-silver-dark">
                  No properties yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {vacantByProperty.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold">Vacant units — {periodLabel}</h2>
          <div className="mt-3 flex flex-col gap-4">
            {vacantByProperty.map(({ property, units }) => (
              <div key={property.id}>
                <h3 className="text-sm font-medium text-silver-dark">{property.name}</h3>
                <div className="mt-1 flex flex-wrap gap-2">
                  {units.map((u) => (
                    <Link
                      key={u.id}
                      href={`/leases/new?unitId=${u.id}`}
                      className="rounded border border-dashed px-2 py-1 text-xs italic text-silver-dark transition-colors hover:bg-silver-light"
                    >
                      {u.label} — vacant{u.monthlyRent ? ` (${money(u.monthlyRent)})` : ""}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
