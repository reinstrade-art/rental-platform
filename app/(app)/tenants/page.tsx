import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getTenants } from "@/app/lib/data";
import { inviteTenant } from "@/app/lib/actions";

export default async function TenantsPage() {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  const tenants = await getTenants(s.organizationId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Tenants</h1>
        <Link href="/tenants/new" className="rounded bg-black px-3 py-1.5 text-sm text-white">
          Add tenant
        </Link>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="py-2">Name</th>
            <th className="py-2">Phone</th>
            <th className="py-2">Email</th>
            <th className="py-2">Leases</th>
            <th className="py-2">Portal access</th>
          </tr>
        </thead>
        <tbody>
          {tenants.map((t) => (
            <tr key={t.id} className="border-b">
              <td className="py-2">{t.name}</td>
              <td className="py-2">{t.phone ?? "—"}</td>
              <td className="py-2">{t.email ?? "—"}</td>
              <td className="py-2">
                {t.leases.map((l) => `${l.unit.property.name} / ${l.unit.label}`).join(", ") || "—"}
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
            </tr>
          ))}
          {tenants.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-gray-500">
                No tenants yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
