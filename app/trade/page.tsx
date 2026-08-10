import { redirect } from "next/navigation";
import { getSession, requireTradesman } from "@/app/lib/auth";
import { getVendorPortal } from "@/app/lib/data";

function money(n: number | null | undefined) {
  return n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default async function TradePortalPage() {
  const s = await getSession();
  if (!requireTradesman(s)) redirect("/login");

  const { awardedRepairs, quotes } = await getVendorPortal(s.vendorId);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold">My awarded jobs</h1>
        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="py-2">Job</th>
              <th className="py-2">Location</th>
              <th className="py-2">Status</th>
              <th className="py-2">Final cost</th>
            </tr>
          </thead>
          <tbody>
            {awardedRepairs.map((r) => (
              <tr key={r.id} className="border-b">
                <td className="py-2">{r.title}</td>
                <td className="py-2">
                  {r.property.name}
                  {r.unit ? ` / ${r.unit.label}` : ""}
                </td>
                <td className="py-2">{r.status}</td>
                <td className="py-2">{money(r.finalCost)}</td>
              </tr>
            ))}
            {awardedRepairs.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-gray-500">
                  No jobs awarded to you yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="text-lg font-semibold">My quotes</h2>
        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
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
                <td colSpan={3} className="py-4 text-gray-500">
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
