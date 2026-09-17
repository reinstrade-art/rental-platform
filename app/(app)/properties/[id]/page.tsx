import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getProperty, monthRange } from "@/app/lib/data";
import { createUnit, updateUnit, deleteProperty, inviteCaretaker, disableStaff, enableStaff } from "@/app/lib/actions";
import { DeleteButton } from "@/app/components/delete-button";
import { MonthNav } from "@/app/components/month-nav";
import { requireModule } from "@/app/lib/permissions";

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default async function PropertyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string; period?: string }>;
}) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  requireModule(s, "properties");
  const { id } = await params;
  const { saved, error, period: periodParam } = await searchParams;
  const property = await getProperty(s.organizationId, id);
  if (!property) notFound();
  const savedUnit = saved ? property.units.find((u) => u.id === saved) : null;

  const now = new Date();
  const period = /^\d{4}-\d{2}$/.test(periodParam ?? "")
    ? periodParam!
    : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const [periodYear, periodMonthNum] = period.split("-").map(Number);
  const periodLabel = `${MONTH_NAMES[periodMonthNum - 1]} ${periodYear}`;
  const { start: periodStart, end: periodEnd } = monthRange(new Date(Date.UTC(periodYear, periodMonthNum - 1, 1)));

  // The lease (if any) actually covering this unit during the selected
  // month — not just "the current lease" — so occupancy and the tenant shown
  // reflect who was there then, not who's there today.
  const activeLeaseByUnit = new Map(
    property.units.map((u) => [
      u.id,
      u.leases.find((l) => l.startDate < periodEnd && (!l.endDate || l.endDate >= periodStart)) ?? null,
    ]),
  );
  const occupied = [...activeLeaseByUnit.values()].filter(Boolean).length;

  // What the portfolio would earn TODAY at full occupancy — deliberately not
  // scoped to the month filter above (that only changes who occupied a unit
  // and what was billed/paid then), so this stays a stable benchmark instead
  // of swinging with whichever past tenant/rent happened to be in place that
  // month. A vacant unit's own listed rent counts too.
  const currentLeaseByUnit = new Map(
    property.units.map((u) => [u.id, u.leases.find((l) => l.status === "ACTIVE") ?? null]),
  );
  const expectedRentTotal = property.units.reduce((sum, u) => {
    const current = currentLeaseByUnit.get(u.id);
    return sum + (current ? current.monthlyRent : (u.monthlyRent ?? 0));
  }, 0);

  // Arrears is this month's billed amount left unpaid — a tenant's advance
  // payment from an earlier month doesn't erase an unpaid current bill, and a
  // current overpayment doesn't count as negative arrears either; it's
  // clamped to zero per lease, same rule the Leases page uses.
  function thisMonthFigures(lease: { charges: { amount: number; periodMonth: Date }[]; payments: { amount: number; paidAt: Date }[] }) {
    const charged = lease.charges
      .filter((c) => c.periodMonth >= periodStart && c.periodMonth < periodEnd)
      .reduce((s, c) => s + c.amount, 0);
    const paid = lease.payments
      .filter((p) => p.paidAt >= periodStart && p.paidAt < periodEnd)
      .reduce((s, p) => s + p.amount, 0);
    return { charged, paid, arrears: Math.max(0, charged - paid) };
  }
  const receivedTotal = [...activeLeaseByUnit.values()].reduce((sum, l) => sum + (l ? thisMonthFigures(l).paid : 0), 0);
  const arrearsTotal = [...activeLeaseByUnit.values()].reduce((sum, l) => sum + (l ? thisMonthFigures(l).arrears : 0), 0);

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
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">{property.name}</h1>
            <p className="text-sm text-silver-dark">{property.address ?? "No address on file"}</p>
          </div>
          <Link href={`/properties/${property.id}/edit`} className="text-xs underline text-silver-dark">
            Edit
          </Link>
        </div>
      </div>

      <MonthNav basePath={`/properties/${property.id}`} period={period} />

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
          <div className="text-xs text-silver-dark">Expected rent (all units)</div>
          <div className="mt-1 text-xl font-semibold">{money(expectedRentTotal)}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Rent received — {periodLabel}</div>
          <div className="mt-1 text-xl font-semibold">{money(receivedTotal)}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Arrears — {periodLabel}</div>
          <div className={`mt-1 text-xl font-semibold ${arrearsTotal > 0 ? "text-red-600" : "text-green-700"}`}>{money(arrearsTotal)}</div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold">Units — {periodLabel}</h2>
        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
              <th className="py-2">Label</th>
              <th className="py-2">Monthly rent</th>
              <th className="py-2">Tenant</th>
              <th className="py-2">Rent received</th>
              <th className="py-2">Arrears</th>
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
                  <td className="py-2">{active ? money(thisMonthFigures(active).paid) : "—"}</td>
                  <td className={`py-2 ${active && thisMonthFigures(active).arrears > 0 ? "text-red-600" : ""}`}>
                    {active ? money(thisMonthFigures(active).arrears) : "—"}
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
                <td colSpan={6} className="py-4 text-silver-dark">
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
