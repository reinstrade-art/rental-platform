import Link from "next/link";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getDashboard, getPropertyRollups, getRepairSummary } from "@/app/lib/data";
import { redirect } from "next/navigation";
import { getOrgTier, hasFeature } from "@/app/lib/tier";

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default async function DashboardPage() {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");

  const [dash, rollups, repairs, tier] = await Promise.all([
    getDashboard(s.organizationId),
    getPropertyRollups(s.organizationId),
    getRepairSummary(s.organizationId),
    getOrgTier(s.organizationId),
  ]);
  const canAlerts = hasFeature(tier, "ARREARS_ALERTS");
  const canRepairs = hasFeature(tier, "REPAIRS");

  const tiles = [
    { label: "Properties", value: dash.propertyCount, href: "/properties" },
    { label: "Units", value: `${dash.occupiedUnits} / ${dash.unitCount} occupied`, href: "/properties" },
    { label: "Active leases", value: dash.activeLeaseCount, href: "/leases" },
    { label: "Billed this month", value: money(dash.billedThisMonth), href: "/leases" },
    { label: "Received this month", value: money(dash.receivedThisMonth), href: "/payments" },
    { label: "Arrears (all leases)", value: money(dash.grossArrears), href: canAlerts ? "/alerts" : "/leases" },
    ...(canRepairs
      ? [
          { label: "Repairs pending", value: `${repairs.pendingCount} (${money(repairs.pendingCost)})`, href: "/repairs" },
          { label: "Repairs done", value: `${repairs.doneCount} (${money(repairs.doneCost)})`, href: "/repairs" },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold">Dashboard</h1>
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
        <h2 className="text-lg font-semibold">By property</h2>
        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
              <th className="py-2">Property</th>
              <th className="py-2">Units</th>
              <th className="py-2">Occupied</th>
              <th className="py-2">Billed this month</th>
              <th className="py-2">Received this month</th>
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
    </div>
  );
}
