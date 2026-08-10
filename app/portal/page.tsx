import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireTenant } from "@/app/lib/auth";
import { getTenantPortal, leaseBalance } from "@/app/lib/data";

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function periodParam(d: Date) {
  const dt = new Date(d);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function TenantPortalPage() {
  const s = await getSession();
  if (!requireTenant(s)) redirect("/login");

  const tenant = await getTenantPortal(s.tenantId);

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-lg font-semibold">Hello, {tenant.name}</h1>

      {tenant.leases.map((lease) => {
        const balance = leaseBalance(lease);
        const periods = [...new Set(lease.charges.map((c) => periodParam(c.periodMonth)))];
        return (
          <div key={lease.id} className="rounded border p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">
                  {lease.unit.property.name} / {lease.unit.label}
                </div>
                <div className="text-xs text-gray-500">
                  {money(lease.monthlyRent)}/month · {lease.status}
                </div>
              </div>
              <div className={`text-right ${balance > 0 ? "text-red-600" : "text-green-700"}`}>
                <div className="text-xs text-gray-500">Balance</div>
                <div className="text-lg font-semibold">{money(balance)}</div>
              </div>
            </div>

            <div className="mt-4 grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold">Charges</h3>
                <table className="mt-1 w-full text-sm">
                  <tbody>
                    {lease.charges.map((c) => (
                      <tr key={c.id} className="border-b">
                        <td className="py-1">
                          {new Date(c.periodMonth).toLocaleDateString(undefined, { year: "numeric", month: "short" })}
                        </td>
                        <td className="py-1">{c.type}</td>
                        <td className="py-1 text-right">{money(c.amount)}</td>
                      </tr>
                    ))}
                    {lease.charges.length === 0 && (
                      <tr>
                        <td className="py-1 text-gray-500">No charges yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <div className="mt-2 flex flex-wrap gap-2">
                  {periods.map((p) => (
                    <Link
                      key={p}
                      href={`/api/invoice/${lease.id}?period=${p}`}
                      target="_blank"
                      className="text-xs underline text-gray-600"
                    >
                      Invoice {p}
                    </Link>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold">Payments</h3>
                <table className="mt-1 w-full text-sm">
                  <tbody>
                    {lease.payments.map((p) => (
                      <tr key={p.id} className="border-b">
                        <td className="py-1">{new Date(p.paidAt).toLocaleDateString()}</td>
                        <td className="py-1">{p.method ?? "—"}</td>
                        <td className="py-1 text-right">{money(p.amount)}</td>
                        <td className="py-1 text-right">
                          <Link href={`/api/receipt/${p.id}`} target="_blank" className="text-xs underline text-gray-600">
                            Receipt
                          </Link>
                        </td>
                      </tr>
                    ))}
                    {lease.payments.length === 0 && (
                      <tr>
                        <td className="py-1 text-gray-500">No payments yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })}
      {tenant.leases.length === 0 && <p className="text-sm text-gray-500">No tenancy on file yet.</p>}
    </div>
  );
}
