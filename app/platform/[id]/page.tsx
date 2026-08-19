import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession, requirePlatformAdmin } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { logPlatformAccess } from "@/app/lib/audit";
import { licenseState, platformMpesaConfigured } from "@/app/lib/licensing";
import { LICENSE_PAYMENT_METHODS } from "@/app/lib/constants";
import {
  updateLicenseFee,
  recordLicensePayment,
  sendLicenseStkAction,
  updateOrgTier,
  platformImpersonateAction,
  confirmTierRequestAction,
  rejectTierRequestAction,
  setOrgTierPriceAction,
} from "@/app/lib/actions";
import { getOrgTierPrices } from "@/app/lib/tier-requests";
import { ORG_TIERS } from "@/app/lib/constants";

const STATE_COLOR: Record<string, string> = {
  TRIAL: "text-orange-600",
  LICENSED: "text-green-700",
  EXPIRED: "text-red-600",
};

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default async function PlatformOrgDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ priceSaved?: string; error?: string }>;
}) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!requirePlatformAdmin(s)) redirect("/dashboard");

  const { id } = await params;
  const { priceSaved, error } = await searchParams;
  const org = await prisma.organization.findUnique({
    where: { id },
    include: {
      properties: { include: { units: true } },
      tenants: true,
      leases: { include: { tenant: true, unit: { include: { property: true } } } },
      users: true,
    },
  });
  if (!org) notFound();

  // Every load of this page is cross-org access for support purposes — logged
  // unconditionally, not on some "did they click a special button" opt-in,
  // so the log is a complete record rather than whatever staff remembered to
  // trigger.
  await logPlatformAccess(s.userId, org.id, "VIEW_ORG_DETAIL", `Viewed by ${s.email ?? s.userId}`);

  const [payments, charges, licensePayments, pendingTierRequests, orgTierPrices] = await Promise.all([
    prisma.payment.aggregate({ where: { organizationId: org.id }, _sum: { amount: true } }),
    prisma.charge.aggregate({ where: { organizationId: org.id }, _sum: { amount: true } }),
    prisma.licensePayment.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.tierChangeRequest.findMany({ where: { organizationId: org.id, status: "PENDING" }, orderBy: { createdAt: "desc" } }),
    getOrgTierPrices(org.id),
  ]);
  const license = licenseState(org);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/platform" className="text-xs underline text-silver-dark">
          All organizations
        </Link>
        <div className="mt-1 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">{org.name}</h1>
            <p className="text-sm text-silver-dark">
              Status: {org.status} · Created {new Date(org.createdAt).toLocaleDateString()}
            </p>
          </div>
          <Link href="/platform/audit" className="text-sm underline text-silver-dark">
            View audit log
          </Link>
        </div>
      </div>

      <div className="rounded border border-silver bg-silver-light p-3 text-sm font-medium text-ink">
        You are viewing this organization&apos;s data as the Platform Administrator, for support purposes. This visit
        has been recorded in the audit log.
      </div>

      {priceSaved && <div className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700">Saved.</div>}
      {error && <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div>
        <h2 className="font-semibold">Package</h2>
        <p className="text-xs text-silver-dark">
          Which modules this customer can see and use — independent of licensing below. Current: <strong>{org.tier}</strong>.
        </p>
        <form action={updateOrgTier.bind(null, org.id)} className="mt-2 flex items-center gap-2">
          <select name="tier" defaultValue={org.tier} className="rounded border px-3 py-2 text-sm">
            {ORG_TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button className="rounded border px-3 py-2 text-sm transition-colors hover:bg-silver-light">Save package</button>
        </form>

        {pendingTierRequests.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            {pendingTierRequests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 rounded border border-orange-300 bg-orange-50 px-3 py-2 text-sm">
                <span>
                  Requested {r.fromTier} → {r.toTier} for {money(r.amount)} via {r.method}
                  {r.reference ? ` (ref ${r.reference})` : ""}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <form action={confirmTierRequestAction.bind(null, r.id)}>
                    <button className="rounded bg-ink px-2 py-1 text-xs text-lily">Confirm &amp; apply</button>
                  </form>
                  <form action={rejectTierRequestAction.bind(null, r.id)}>
                    <button className="text-xs text-red-700 underline">Reject</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4">
          <p className="text-xs text-silver-dark">
            Negotiated upgrade prices for this customer — overrides the standard list price on Settings → Plan for
            just this org. Leave blank and save to remove an override and go back to the standard price.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ORG_TIERS.map((t) => (
              <form key={t} action={setOrgTierPriceAction.bind(null, org.id, t)} className="flex flex-col gap-1 rounded border p-2">
                <span className="text-xs font-medium text-silver-dark">{t}</span>
                <input
                  name="priceKes"
                  type="number"
                  step="0.01"
                  defaultValue={orgTierPrices[t] ?? ""}
                  placeholder="Standard"
                  className="rounded border px-2 py-1 text-sm"
                />
                <button className="rounded border px-2 py-1 text-xs transition-colors hover:bg-silver-light">Save</button>
              </form>
            ))}
          </div>
        </div>
      </div>

      <div>
        <h2 className="font-semibold">Licensing</h2>
        <p className={`mt-1 text-sm font-medium ${STATE_COLOR[license.state]}`}>
          {license.state === "TRIAL" && `On trial — ${license.daysLeft} day${license.daysLeft === 1 ? "" : "s"} left (until ${license.activeUntil?.toLocaleDateString()})`}
          {license.state === "LICENSED" && `Licensed until ${license.activeUntil?.toLocaleDateString()} (${license.daysLeft} day${license.daysLeft === 1 ? "" : "s"} left)`}
          {license.state === "EXPIRED" && "Expired — this organization's staff and tenants cannot sign in until a license payment is recorded."}
        </p>

        <div className="mt-4 grid gap-8 md:grid-cols-3">
          <form action={updateLicenseFee.bind(null, org.id)} className="flex flex-col gap-2">
            <label className="text-xs text-silver-dark">
              Monthly fee (KES)
              <input
                name="licenseFeeKes"
                type="number"
                step="0.01"
                defaultValue={org.licenseFeeKes ?? ""}
                className="mt-1 block w-full rounded border px-3 py-2 text-sm"
              />
            </label>
            <button className="rounded border px-3 py-2 text-sm transition-colors hover:bg-silver-light">Save fee</button>
          </form>

          <form action={recordLicensePayment.bind(null, org.id)} className="flex flex-col gap-2">
            <p className="text-xs font-medium text-silver-dark">Record a payment (bank, cash, etc.)</p>
            <input name="amount" type="number" step="0.01" required placeholder="Amount (KES)" defaultValue={org.licenseFeeKes ?? ""} className="rounded border px-3 py-2 text-sm" />
            <select name="method" className="rounded border px-3 py-2 text-sm">
              {LICENSE_PAYMENT_METHODS.filter((m) => m !== "MPESA_STK").map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input name="reference" placeholder="Reference (optional)" className="rounded border px-3 py-2 text-sm" />
            <input name="periodDays" type="number" defaultValue={30} className="rounded border px-3 py-2 text-sm" />
            <button className="rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">Record payment</button>
          </form>

          <form action={sendLicenseStkAction.bind(null, org.id)} className="flex flex-col gap-2">
            <p className="text-xs font-medium text-silver-dark">
              {platformMpesaConfigured() ? "Bill by M-Pesa STK Push" : "M-Pesa STK not configured on this platform"}
            </p>
            <input name="phone" placeholder="Phone (2547...)" disabled={!platformMpesaConfigured()} className="rounded border px-3 py-2 text-sm disabled:opacity-50" />
            <input name="amount" type="number" step="0.01" placeholder="Amount (KES)" defaultValue={org.licenseFeeKes ?? ""} disabled={!platformMpesaConfigured()} className="rounded border px-3 py-2 text-sm disabled:opacity-50" />
            <input name="periodDays" type="number" defaultValue={30} disabled={!platformMpesaConfigured()} className="rounded border px-3 py-2 text-sm disabled:opacity-50" />
            <button disabled={!platformMpesaConfigured()} className="rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft disabled:opacity-50">
              Send prompt
            </button>
          </form>
        </div>

        {licensePayments.length > 0 && (
          <table className="mt-4 w-full max-w-2xl border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
                <th className="py-1">Date</th>
                <th className="py-1">Amount</th>
                <th className="py-1">Method</th>
                <th className="py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {licensePayments.map((p) => (
                <tr key={p.id} className="border-b">
                  <td className="py-1">{new Date(p.createdAt).toLocaleDateString()}</td>
                  <td className="py-1">{money(p.amount)}</td>
                  <td className="py-1">{p.method}</td>
                  <td className="py-1">{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <h2 className="font-semibold">Team</h2>
        <p className="text-xs text-silver-dark">
          Sign in as this organization&apos;s own staff to view, edit, or delete its data through their real
          screens — never a separate platform-side copy. Every sign-in here is recorded in the audit log.
        </p>
        <table className="mt-2 w-full max-w-lg border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
              <th className="py-1">Email</th>
              <th className="py-1">Role</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {org.users.map((u) => (
              <tr key={u.id} className="border-b">
                <td className="py-1">{u.email ?? u.phone}</td>
                <td className="py-1">{u.role}</td>
                <td className="py-1">
                  {u.disabledAt ? (
                    <span className="text-xs text-silver-dark">Disabled</span>
                  ) : (
                    <form action={platformImpersonateAction.bind(null, u.id)}>
                      <button className="text-xs underline">Sign in as</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {org.users.length === 0 && (
              <tr>
                <td colSpan={3} className="py-2 text-silver-dark">
                  No staff yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Staff users</div>
          <div className="mt-1 text-xl font-semibold">{org.users.length}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Properties / Units</div>
          <div className="mt-1 text-xl font-semibold">
            {org.properties.length} / {org.properties.reduce((s, p) => s + p.units.length, 0)}
          </div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Tenants / Leases</div>
          <div className="mt-1 text-xl font-semibold">
            {org.tenants.length} / {org.leases.length}
          </div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Billed / Received (all-time)</div>
          <div className="mt-1 text-xl font-semibold">
            {money(charges._sum.amount ?? 0)} / {money(payments._sum.amount ?? 0)}
          </div>
        </div>
      </div>

      <div>
        <h2 className="font-semibold">Properties</h2>
        <p className="text-xs text-silver-dark">Click a property to see its leases.</p>
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
              <th className="py-1">Property</th>
              <th className="py-1">Units</th>
              <th className="py-1">Occupied</th>
            </tr>
          </thead>
          <tbody>
            {org.properties.map((p) => {
              const occupied = p.units.filter((u) => org.leases.some((l) => l.unitId === u.id && l.status === "ACTIVE")).length;
              return (
                <tr key={p.id} className="border-b">
                  <td className="py-1">
                    <Link href={`/platform/${org.id}/properties/${p.id}`} className="underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className="py-1">{p.units.length}</td>
                  <td className="py-1">{occupied}</td>
                </tr>
              );
            })}
            {org.properties.length === 0 && (
              <tr>
                <td colSpan={3} className="py-4 text-silver-dark">
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
