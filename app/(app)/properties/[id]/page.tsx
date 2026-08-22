import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getProperty, leaseBalance } from "@/app/lib/data";
import { createUnit, updateUnit, deleteProperty, inviteCaretaker, disableStaff, enableStaff } from "@/app/lib/actions";
import { DeleteButton } from "@/app/components/delete-button";

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default async function PropertyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  const { id } = await params;
  const { saved, error } = await searchParams;
  const property = await getProperty(s.organizationId, id);
  if (!property) notFound();
  const savedUnit = saved ? property.units.find((u) => u.id === saved) : null;

  const activeLeaseByUnit = new Map(
    property.units.map((u) => [u.id, u.leases.find((l) => l.status === "ACTIVE") ?? null]),
  );
  const occupied = [...activeLeaseByUnit.values()].filter(Boolean).length;
  const monthlyRentTotal = [...activeLeaseByUnit.values()].reduce((sum, l) => sum + (l?.monthlyRent ?? 0), 0);
  const balanceOwed = [...activeLeaseByUnit.values()].reduce((sum, l) => sum + (l ? leaseBalance(l) : 0), 0);

  return (
    <div className="flex flex-col gap-8">
      {error && <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {savedUnit && (
        <div className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700">
          Saved — unit {savedUnit.label} updated.
        </div>
      )}
      <div>
        <Link href="/properties" className="text-xs underline text-silver-dark">
          All properties
        </Link>
        <div className="mt-1 flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold">{property.name}</h1>
            <p className="text-sm text-silver-dark">{property.address ?? "No address on file"}</p>
          </div>
          <Link href={`/properties/${property.id}/edit`} className="text-xs underline text-silver-dark">
            Edit
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Units</div>
          <div className="mt-1 text-xl font-semibold">{property.units.length}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Occupied / Vacant</div>
          <div className="mt-1 text-xl font-semibold">
            {occupied} / {property.units.length - occupied}
          </div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Monthly rent (occupied)</div>
          <div className="mt-1 text-xl font-semibold">{money(monthlyRentTotal)}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">{balanceOwed > 0 ? "Owed (active leases)" : "Balance"}</div>
          <div className={`mt-1 text-xl font-semibold ${balanceOwed > 0 ? "text-red-600" : ""}`}>{money(balanceOwed)}</div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold">Units</h2>
        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
              <th className="py-2">Label</th>
              <th className="py-2">Monthly rent</th>
              <th className="py-2">Tenant</th>
              <th className="py-2">Balance</th>
              <th className="py-2">Payment code</th>
            </tr>
          </thead>
          <tbody>
            {property.units.map((u) => {
              const active = activeLeaseByUnit.get(u.id);
              const formId = `unit-${u.id}`;
              return (
                <tr key={u.id} className="border-b">
                  <td className="py-2">
                    <form id={formId} action={updateUnit.bind(null, u.id)} />
                    <input
                      form={formId}
                      name="label"
                      required
                      defaultValue={u.label}
                      className="w-20 rounded border px-2 py-1"
                    />
                  </td>
                  <td className="py-2">
                    <input
                      form={formId}
                      name="monthlyRent"
                      type="number"
                      step="0.01"
                      defaultValue={u.monthlyRent ?? ""}
                      className="w-24 rounded border px-2 py-1"
                    />
                  </td>
                  <td className="py-2">
                    {active ? (
                      <Link href={`/leases/${active.id}`} className="underline">
                        {active.tenant.name}
                      </Link>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-silver-dark">Vacant</span>
                        <Link href={`/leases/new?unitId=${u.id}`} className="text-xs underline">
                          Add tenant
                        </Link>
                      </div>
                    )}
                  </td>
                  <td className={`py-2 ${active && leaseBalance(active) > 0 ? "text-red-600" : ""}`}>
                    {active ? money(leaseBalance(active)) : "—"}
                  </td>
                  <td className="py-2">
                    <div className="flex gap-1">
                      <input
                        form={formId}
                        name="paymentCode"
                        defaultValue={u.paymentCode ?? ""}
                        placeholder="e.g. A1"
                        className="w-20 rounded border px-2 py-1 text-xs"
                      />
                      <button
                        form={formId}
                        className="rounded bg-ink px-2 py-1 text-xs text-lily transition-colors hover:bg-ink-soft"
                      >
                        Save
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {property.units.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-silver-dark">
                  No units yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-silver-dark">
          A unit&apos;s payment code is matched against incoming transaction references (M-Pesa, bank, manual) to
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

      {s.role === "ADMIN" && (
        <div className="max-w-md">
          <h2 className="text-lg font-semibold">Caretakers</h2>
          <p className="mt-1 text-xs text-silver-dark">
            A caretaker&apos;s account can only see and onboard tenants for this property — nothing else in the app.
          </p>
          {property.caretakers.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2">
              {property.caretakers.map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                  <span>
                    {c.email ?? c.phone}
                    {c.disabledAt && <span className="ml-2 text-xs text-silver-dark">Disabled</span>}
                  </span>
                  {c.disabledAt ? (
                    <form action={enableStaff.bind(null, c.id)}>
                      <button className="text-xs underline">Restore access</button>
                    </form>
                  ) : (
                    <form action={disableStaff.bind(null, c.id)}>
                      <button className="text-xs text-red-700 underline">Disable</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form action={inviteCaretaker.bind(null, property.id)} className="mt-3 flex flex-col gap-2">
            <input name="phone" placeholder="Phone" className="rounded border px-3 py-2 text-sm" />
            <input name="email" type="email" placeholder="Email" className="rounded border px-3 py-2 text-sm" />
            <button type="submit" className="rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
              Invite a caretaker
            </button>
          </form>
        </div>
      )}

      {property.units.length === 0 && (
        <div className="max-w-sm border-t pt-6">
          <h2 className="font-semibold text-red-600">Delete property</h2>
          <p className="mt-1 text-xs text-silver-dark">{property.name} has no units, so this is safe to delete.</p>
          <form action={deleteProperty.bind(null, property.id)} className="mt-2">
            <DeleteButton confirmText={`Delete ${property.name}? This cannot be undone.`} />
          </form>
        </div>
      )}
    </div>
  );
}
