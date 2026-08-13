import Link from "next/link";
import { prisma } from "@/app/lib/prisma";
import { createOrganization, setOrganizationStatus } from "@/app/lib/actions";

export default async function PlatformPage() {
  const orgs = await prisma.organization.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { properties: true, tenants: true, users: true } } },
  });

  return (
    <div className="flex flex-col gap-8">
      <section>
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Organizations</h1>
          <Link href="/platform/audit" className="text-sm underline text-silver-dark">
            Audit log
          </Link>
        </div>
        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
              <th className="py-2">Name</th>
              <th className="py-2">Status</th>
              <th className="py-2">Properties</th>
              <th className="py-2">Tenants</th>
              <th className="py-2">Users</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id} className="border-b">
                <td className="py-2">
                  <Link href={`/platform/${o.id}`} className="underline">
                    {o.name}
                  </Link>
                </td>
                <td className="py-2">{o.status}</td>
                <td className="py-2">{o._count.properties}</td>
                <td className="py-2">{o._count.tenants}</td>
                <td className="py-2">{o._count.users}</td>
                <td className="py-2">
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
                </td>
              </tr>
            ))}
            {orgs.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-silver-dark">
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
