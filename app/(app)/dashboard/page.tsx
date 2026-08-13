import { getSession, requireStaff } from "@/app/lib/auth";
import { getDashboard, getPropertyRollups, getRepairSummary } from "@/app/lib/data";
import { redirect } from "next/navigation";

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default async function DashboardPage() {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");

  const [dash, rollups, repairs] = await Promise.all([
    getDashboard(s.organizationId),
    getPropertyRollups(s.organizationId),
    getRepairSummary(s.organizationId),
  ]);

  const tiles = [
    { label: "Properties", value: dash.propertyCount },
    { label: "Units", value: `${dash.occupiedUnits} / ${dash.unitCount} occupied` },
    { label: "Active leases", value: dash.activeLeaseCount },
    { label: "Billed this month", value: money(dash.billedThisMonth) },
    { label: "Received this month", value: money(dash.receivedThisMonth) },
    { label: "Arrears (all leases)", value: money(dash.grossArrears) },
    { label: "Repairs pending", value: `${repairs.pendingCount} (${money(repairs.pendingCost)})` },
    { label: "Repairs done", value: `${repairs.doneCount} (${money(repairs.doneCost)})` },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
          {tiles.map((t) => (
            <div key={t.label} className="rounded border p-4">
              <div className="text-xs text-silver-dark">{t.label}</div>
              <div className="mt-1 text-xl font-semibold">{t.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold">By property</h2>
        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-silver-dark">
              <th className="py-2">Property</th>
              <th className="py-2">Units</th>
              <th className="py-2">Occupied</th>
              <th className="py-2">Billed this month</th>
              <th className="py-2">Received this month</th>
            </tr>
          </thead>
          <tbody>
            {rollups.map((p) => (
              <tr key={p.id} className="border-b">
                <td className="py-2">{p.name}</td>
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
