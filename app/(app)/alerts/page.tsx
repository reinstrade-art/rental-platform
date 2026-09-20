import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getArrearsAlerts } from "@/app/lib/alerts";
import { getOrgTier, hasFeature } from "@/app/lib/tier";
import { waLink } from "@/app/lib/phone";
import { requireModule } from "@/app/lib/permissions";
import { tenantView } from "@/app/lib/pii";

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function monthLabel(d: Date) {
  return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", timeZone: "UTC" });
}

export default async function AlertsPage() {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  if (!hasFeature(await getOrgTier(s.organizationId), "ARREARS_ALERTS")) redirect("/home");
  requireModule(s, "alerts");
  const v = tenantView(s); // surnames + phone numbers hidden below manager/director/admin

  const alerts = await getArrearsAlerts(s.organizationId);
  const serious = alerts.filter((a) => a.severity === "serious");
  const owed = alerts.reduce((s, a) => s + a.balance, 0);
  const reachable = alerts.filter((a) => a.phone).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Arrears alerts</h1>
        <p className="text-sm text-silver-dark">Tenants owing 2× the rent, or whose oldest unpaid charge is more than two months old.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Flagged tenants</div>
          <div className="mt-1 text-xl font-semibold">{alerts.length}</div>
          <div className="text-xs text-silver-dark">{serious.length} serious</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Total at risk</div>
          <div className="mt-1 text-xl font-semibold">{money(owed)}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Contactable</div>
          <div className="mt-1 text-xl font-semibold">
            {reachable} / {alerts.length}
          </div>
          <div className="text-xs text-silver-dark">Have a phone number</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Rules applied</div>
          <div className="mt-1 text-xl font-semibold">2× / 2 mo</div>
          <div className="text-xs text-silver-dark">Rent multiple · age of debt</div>
        </div>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
            <th className="py-2">Tenant</th>
            <th className="py-2">Unit</th>
            <th className="py-2">Owed</th>
            <th className="py-2">Why flagged</th>
            <th className="py-2">Oldest unpaid</th>
            <th className="py-2">Contact</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((a) => (
            <tr key={a.leaseId} className="border-b">
              <td className="py-2">
                <Link href={`/leases/${a.leaseId}`} className="underline">
                  {v.name(a.tenant)}
                </Link>
                {a.severity === "serious" && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">serious</span>}
              </td>
              <td className="py-2">
                {a.property} / {a.unit}
              </td>
              <td className="py-2 font-medium text-red-600">{money(a.balance)}</td>
              <td className="py-2 text-xs text-silver-dark">{a.reasons.join("; ")}</td>
              <td className="py-2">{a.oldestUnpaidPeriod ? monthLabel(a.oldestUnpaidPeriod) : "—"}</td>
              <td className="py-2">
                {a.phone && !v.visible ? (
                  <span className="text-xs text-silver-dark">Hidden</span>
                ) : a.phone ? (
                  <a
                    href={
                      waLink(
                        a.phone,
                        `Hello ${a.tenant}, this is a reminder that your rent account for ${a.property} unit ${a.unit} is in arrears of KES ${Math.round(a.balance).toLocaleString()}. Kindly settle at your earliest convenience.`,
                      ) ?? "#"
                    }
                    className="text-xs underline text-green-700"
                  >
                    WhatsApp
                  </a>
                ) : (
                  <Link href={`/tenants/${a.tenantId}/edit`} className="text-xs underline text-orange-600">
                    add phone
                  </Link>
                )}
              </td>
            </tr>
          ))}
          {alerts.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-silver-dark">
                Nothing to chase — no tenant owes two months&apos; rent or has a charge older than two months.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
