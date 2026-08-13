import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getVendors } from "@/app/lib/data";
import { setVendorPrequalified, inviteVendor } from "@/app/lib/actions";

export default async function VendorsPage() {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  const vendors = await getVendors(s.organizationId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Vendors / Tradesmen</h1>
        <Link href="/vendors/new" className="rounded bg-ink px-3 py-1.5 text-sm text-lily transition-colors hover:bg-ink-soft">
          Add vendor
        </Link>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-silver-dark">
            <th className="py-2">Name</th>
            <th className="py-2">Trade</th>
            <th className="py-2">Contact</th>
            <th className="py-2">Prequalified</th>
            <th className="py-2">Portal access</th>
          </tr>
        </thead>
        <tbody>
          {vendors.map((v) => (
            <tr key={v.id} className="border-b">
              <td className="py-2">{v.name}</td>
              <td className="py-2">{v.trade ?? "—"}</td>
              <td className="py-2">{[v.contactName, v.phone, v.email].filter(Boolean).join(" · ") || "—"}</td>
              <td className="py-2">
                <form action={setVendorPrequalified.bind(null, v.id, !v.prequalified)}>
                  <button className={`text-xs underline ${v.prequalified ? "text-green-700" : "text-silver-dark"}`}>
                    {v.prequalified ? "Yes — revoke" : "No — prequalify"}
                  </button>
                </form>
              </td>
              <td className="py-2">
                {v.user ? (
                  <span className="text-xs text-green-700">Registered ({v.user.role})</span>
                ) : (
                  <form action={inviteVendor.bind(null, v.id)} className="flex items-center gap-1">
                    <select name="workerType" defaultValue="TRADESMAN" className="rounded border text-xs">
                      <option value="TRADESMAN">Tradesman</option>
                      <option value="CASUAL_LABOURER">Casual labourer</option>
                    </select>
                    <button className="text-xs underline" disabled={!v.email && !v.phone}>
                      Invite
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
          {vendors.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-silver-dark">
                No vendors yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
