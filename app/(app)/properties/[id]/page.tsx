import { redirect, notFound } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getProperty } from "@/app/lib/data";
import { createUnit, setUnitPaymentCode } from "@/app/lib/actions";

export default async function PropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  const { id } = await params;
  const property = await getProperty(s.organizationId, id);
  if (!property) notFound();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold">{property.name}</h1>
        <p className="text-sm text-silver-dark">{property.address ?? "No address on file"}</p>
      </div>

      <div>
        <h2 className="text-lg font-semibold">Units</h2>
        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
              <th className="py-2">Label</th>
              <th className="py-2">Monthly rent</th>
              <th className="py-2">Status</th>
              <th className="py-2">Payment code</th>
            </tr>
          </thead>
          <tbody>
            {property.units.map((u) => {
              const active = u.leases.find((l) => l.status === "ACTIVE");
              return (
                <tr key={u.id} className="border-b">
                  <td className="py-2">{u.label}</td>
                  <td className="py-2">{u.monthlyRent ?? "—"}</td>
                  <td className="py-2">{active ? `Occupied — ${active.tenant.name}` : "Vacant"}</td>
                  <td className="py-2">
                    <form action={setUnitPaymentCode.bind(null, u.id)} className="flex gap-1">
                      <input
                        name="paymentCode"
                        defaultValue={u.paymentCode ?? ""}
                        placeholder="e.g. A1"
                        className="w-20 rounded border px-2 py-1 text-xs"
                      />
                      <button className="text-xs underline">Save</button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {property.units.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-silver-dark">
                  No units yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-silver-dark">
          A unit's payment code is matched against incoming transaction references (M-Pesa, bank, manual) to
          auto-record rent payments — see Payments.
        </p>
      </div>

      <div className="max-w-sm">
        <h2 className="text-lg font-semibold">Add unit</h2>
        <form action={createUnit.bind(null, property.id)} className="mt-3 flex flex-col gap-3">
          <input name="label" required placeholder="Unit label (e.g. 4B)" className="rounded border px-3 py-2" />
          <input
            name="monthlyRent"
            type="number"
            step="0.01"
            placeholder="Monthly rent (optional)"
            className="rounded border px-3 py-2"
          />
          <button type="submit" className="rounded bg-ink px-3 py-2 text-lily transition-colors hover:bg-ink-soft">
            Add unit
          </button>
        </form>
      </div>
    </div>
  );
}
