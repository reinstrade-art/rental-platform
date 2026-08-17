import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getTenants } from "@/app/lib/data";
import { inviteTenant, deleteTenant, importTenantsCsv } from "@/app/lib/actions";
import { DeleteButton } from "@/app/components/delete-button";
import { getOrgTier, hasFeature } from "@/app/lib/tier";

export default async function TenantsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  const tenants = await getTenants(s.organizationId);
  const canImport = hasFeature(await getOrgTier(s.organizationId), "CSV_IMPORT");
  const { error } = await searchParams;

  return (
    <div className="flex flex-col gap-8">
      {error && <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Tenants</h1>
        <Link href="/tenants/new" className="rounded bg-ink px-3 py-1.5 text-sm text-lily transition-colors hover:bg-ink-soft">
          Add tenant
        </Link>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
            <th className="py-2">Name</th>
            <th className="py-2">Phone</th>
            <th className="py-2">Email</th>
            <th className="py-2">Leases</th>
            <th className="py-2">Portal access</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {tenants.map((t) => (
            <tr key={t.id} className="border-b">
              <td className="py-2">
                <Link href={`/tenants/${t.id}`} className="underline">
                  {t.name}
                </Link>
              </td>
              <td className="py-2">{t.phone ?? "—"}</td>
              <td className="py-2">{t.email ?? "—"}</td>
              <td className="py-2">
                {t.leases.length === 0 ? (
                  "—"
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {t.leases.map((l) => (
                      <Link
                        key={l.id}
                        href={`/leases/${l.id}`}
                        className={`underline ${l.status === "ACTIVE" ? "" : "text-silver-dark"}`}
                      >
                        {l.unit.property.name} / {l.unit.label}
                        <span className="ml-1 text-xs">({l.status === "ACTIVE" ? "active" : "ended"})</span>
                      </Link>
                    ))}
                  </div>
                )}
              </td>
              <td className="py-2">
                {t.user ? (
                  <span className="text-xs text-green-700">Registered</span>
                ) : (
                  <form action={inviteTenant.bind(null, t.id)}>
                    <button className="text-xs underline" disabled={!t.email && !t.phone}>
                      Invite to register
                    </button>
                  </form>
                )}
              </td>
              <td className="py-2">
                <div className="flex items-center justify-end gap-3">
                  <Link href={`/leases/new?tenantId=${t.id}`} className="text-xs underline">
                    Add lease
                  </Link>
                  <Link href={`/tenants/${t.id}/edit`} className="text-xs underline text-silver-dark">
                    Edit
                  </Link>
                  <form action={deleteTenant.bind(null, t.id)}>
                    <DeleteButton confirmText={`Delete ${t.name}? This cannot be undone.`} />
                  </form>
                </div>
              </td>
            </tr>
          ))}
          {tenants.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-silver-dark">
                No tenants yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {canImport && (
        <div className="max-w-sm">
          <h2 className="font-semibold">Import a CSV</h2>
          <p className="text-xs text-silver-dark">One row per tenant: name,phone,email</p>
          <form action={importTenantsCsv} className="mt-3 flex flex-col gap-2" encType="multipart/form-data">
            <input name="file" type="file" accept=".csv,text/csv" required className="rounded border px-3 py-2 text-sm" />
            <button type="submit" className="rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
              Import
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
