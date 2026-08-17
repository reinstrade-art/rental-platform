import Link from "next/link";
import { prisma } from "@/app/lib/prisma";
import { createOrganization, setOrganizationStatus, updateOrganization, deleteOrganization } from "@/app/lib/actions";
import { licenseState } from "@/app/lib/licensing";
import { DeleteButton } from "@/app/components/delete-button";

const STATE_COLOR: Record<string, string> = {
  TRIAL: "text-orange-600",
  LICENSED: "text-green-700",
  EXPIRED: "text-red-600",
};

export default async function PlatformPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const orgs = await prisma.organization.findMany({ orderBy: { createdAt: "desc" } });
  const { error } = await searchParams;

  return (
    <div className="flex flex-col gap-8">
      <section>
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Organizations</h1>
          <Link href="/platform/audit" className="text-sm underline text-silver-dark">
            Audit log
          </Link>
        </div>
        <p className="mt-1 text-sm text-silver-dark">Click a holding company to see its properties, and a property to see its leases.</p>
        {error && (
          <div className="mt-3 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
        )}
        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
              <th className="py-2">Name</th>
              <th className="py-2">Status</th>
              <th className="py-2">License</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => {
              const license = licenseState(o);
              return (
              <tr key={o.id} className="border-b">
                <td className="py-2">
                  <Link href={`/platform/${o.id}`} className="underline">
                    {o.name}
                  </Link>
                </td>
                <td className="py-2">{o.status}</td>
                <td className={`py-2 ${STATE_COLOR[license.state]}`}>
                  {license.state}
                  {license.daysLeft !== null && license.state !== "EXPIRED" ? ` (${license.daysLeft}d)` : ""}
                </td>
                <td className="py-2">
                  <div className="flex items-center justify-end gap-3">
                    <details className="relative">
                      <summary className="cursor-pointer text-xs underline text-silver-dark">Edit</summary>
                      <form
                        action={updateOrganization.bind(null, o.id)}
                        className="absolute right-0 z-10 mt-1 flex gap-1 rounded border bg-lily p-2 shadow-lg"
                      >
                        <input name="name" required defaultValue={o.name} className="w-40 rounded border px-2 py-1 text-xs" />
                        <button className="rounded border px-2 py-1 text-xs hover:bg-silver-light">Save</button>
                      </form>
                    </details>
                    <form
                      action={setOrganizationStatus.bind(
                        null,
                        o.id,
                        o.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
                      )}
                    >
                      <button className="text-xs underline text-silver-dark">
                        {o.status === "ACTIVE" ? "Suspend" : "Reactivate"}
                      </button>
                    </form>
                    <form action={deleteOrganization.bind(null, o.id)}>
                      <DeleteButton confirmText={`Delete ${o.name}? Only possible while it has no properties, tenants, or vendors on file.`} />
                    </form>
                  </div>
                </td>
              </tr>
              );
            })}
            {orgs.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-silver-dark">
                  No organizations yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="max-w-sm">
        <h2 className="text-lg font-semibold">Onboard a new organization</h2>
        <form action={createOrganization} className="mt-3 flex flex-col gap-3">
          <input name="name" required placeholder="Organization name" className="rounded border px-3 py-2" />
          <input
            name="adminEmail"
            type="email"
            required
            placeholder="Org admin email"
            className="rounded border px-3 py-2"
          />
          <input
            name="adminPassword"
            type="password"
            required
            minLength={8}
            placeholder="Org admin password (8+ chars)"
            className="rounded border px-3 py-2"
          />
          <button type="submit" className="rounded bg-ink px-3 py-2 text-lily transition-colors hover:bg-ink-soft">
            Create organization
          </button>
        </form>
      </section>
    </div>
  );
}
