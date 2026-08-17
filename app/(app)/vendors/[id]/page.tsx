import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getVendor } from "@/app/lib/data";
import { setVendorPrequalified, inviteVendor, deleteVendor } from "@/app/lib/actions";
import { DeleteButton } from "@/app/components/delete-button";
import { getOrgTier, hasFeature } from "@/app/lib/tier";

function money(n: number | null | undefined) {
  return n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  if (!hasFeature(await getOrgTier(s.organizationId), "REPAIRS")) redirect("/dashboard");
  const { id } = await params;
  const vendor = await getVendor(s.organizationId, id);
  if (!vendor) notFound();

  const acceptedQuotes = vendor.quotes.filter((q) => q.status === "ACCEPTED");
  const doneJobs = vendor.repairs.filter((r) => r.status === "DONE");

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/vendors" className="text-xs underline text-silver-dark">
          All vendors
        </Link>
        <div className="mt-1 flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold">{vendor.name}</h1>
            <p className="text-sm text-silver-dark">
              {vendor.trade ?? "No trade on file"}
              {vendor.contactName ? ` · ${vendor.contactName}` : ""}
              {[vendor.phone, vendor.email].filter(Boolean).length > 0
                ? ` · ${[vendor.phone, vendor.email].filter(Boolean).join(" · ")}`
                : ""}
            </p>
          </div>
          <Link href={`/vendors/${vendor.id}/edit`} className="text-xs underline text-silver-dark">
            Edit
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Prequalified</div>
          <div className="mt-1 text-sm font-semibold">
            <form action={setVendorPrequalified.bind(null, vendor.id, !vendor.prequalified)}>
              <button className={vendor.prequalified ? "text-green-700 underline" : "text-silver-dark underline"}>
                {vendor.prequalified ? "Yes — revoke" : "No — prequalify"}
              </button>
            </form>
          </div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Jobs (done)</div>
          <div className="mt-1 text-xl font-semibold">{doneJobs.length}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Quotes accepted</div>
          <div className="mt-1 text-xl font-semibold">{acceptedQuotes.length}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Portal access</div>
          <div className="mt-1 text-sm font-semibold">
            {vendor.user ? (
              <span className="text-green-700">Registered ({vendor.user.role})</span>
            ) : (
              <form action={inviteVendor.bind(null, vendor.id)} className="flex items-center gap-1">
                <select name="workerType" defaultValue="TRADESMAN" className="rounded border text-xs">
                  <option value="TRADESMAN">Tradesman</option>
                  <option value="CASUAL_LABOURER">Casual labourer</option>
                </select>
                <button className="text-xs underline" disabled={!vendor.email && !vendor.phone}>
                  Invite
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      <div>
        <h2 className="font-semibold">Jobs awarded</h2>
        {vendor.repairs.length === 0 ? (
          <p className="mt-2 text-sm text-silver-dark">No jobs awarded to this vendor yet.</p>
        ) : (
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
                <th className="py-1">Job</th>
                <th className="py-1">Property</th>
                <th className="py-1">Status</th>
                <th className="py-1">Cost</th>
              </tr>
            </thead>
            <tbody>
              {vendor.repairs.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="py-1">
                    <Link href={`/repairs/${r.id}`} className="underline">
                      {r.title}
                    </Link>
                  </td>
                  <td className="py-1">
                    {r.property.name}
                    {r.unit ? ` / ${r.unit.label}` : ""}
                  </td>
                  <td className="py-1">{r.status}</td>
                  <td className="py-1">{money(r.status === "DONE" ? r.finalCost : r.approvedCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <h2 className="font-semibold">Quote history</h2>
        {vendor.quotes.length === 0 ? (
          <p className="mt-2 text-sm text-silver-dark">No quotes submitted yet.</p>
        ) : (
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
                <th className="py-1">Job</th>
                <th className="py-1">Amount</th>
                <th className="py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {vendor.quotes.map((q) => (
                <tr key={q.id} className="border-b">
                  <td className="py-1">
                    <Link href={`/repairs/${q.repairId}`} className="underline">
                      {q.repair.property.name}
                      {q.repair.unit ? ` / ${q.repair.unit.label}` : ""}
                    </Link>
                  </td>
                  <td className="py-1">{money(q.amount)}</td>
                  <td className="py-1">{q.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {vendor.notes && (
        <div className="max-w-lg">
          <h2 className="font-semibold">Notes</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm text-silver-dark">{vendor.notes}</p>
        </div>
      )}

      {vendor.quotes.length === 0 && !vendor.user && (
        <div className="max-w-sm border-t pt-6">
          <h2 className="font-semibold text-red-600">Delete vendor</h2>
          <p className="mt-1 text-xs text-silver-dark">
            {vendor.name} has no quote history and no portal login, so this is safe to delete.
          </p>
          <form action={deleteVendor.bind(null, vendor.id)} className="mt-2">
            <DeleteButton confirmText={`Delete ${vendor.name}? This cannot be undone.`} />
          </form>
        </div>
      )}
    </div>
  );
}
