import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession, requirePlatformAdmin } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { logPlatformAccess } from "@/app/lib/audit";

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default async function PlatformOrgDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!requirePlatformAdmin(s)) redirect("/dashboard");

  const { id } = await params;
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

  const [payments, charges] = await Promise.all([
    prisma.payment.aggregate({ where: { organizationId: org.id }, _sum: { amount: true } }),
    prisma.charge.aggregate({ where: { organizationId: org.id }, _sum: { amount: true } }),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{org.name}</h1>
          <p className="text-sm text-gray-500">
            Status: {org.status} · Created {new Date(org.createdAt).toLocaleDateString()}
          </p>
        </div>
        <Link href="/platform/audit" className="text-sm underline text-gray-600">
          View audit log
        </Link>
      </div>

      <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
        You are viewing this organization's data as the Platform Administrator, for support purposes. This visit
        has been recorded in the audit log.
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded border p-4">
          <div className="text-xs text-gray-500">Staff users</div>
          <div className="mt-1 text-xl font-semibold">{org.users.length}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-gray-500">Properties / Units</div>
          <div className="mt-1 text-xl font-semibold">
            {org.properties.length} / {org.properties.reduce((s, p) => s + p.units.length, 0)}
          </div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-gray-500">Tenants / Leases</div>
          <div className="mt-1 text-xl font-semibold">
            {org.tenants.length} / {org.leases.length}
          </div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-gray-500">Billed / Received (all-time)</div>
          <div className="mt-1 text-xl font-semibold">
            {money(charges._sum.amount ?? 0)} / {money(payments._sum.amount ?? 0)}
          </div>
        </div>
      </div>

      <div>
        <h2 className="font-semibold">Leases</h2>
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="py-1">Tenant</th>
              <th className="py-1">Unit</th>
              <th className="py-1">Monthly rent</th>
              <th className="py-1">Status</th>
            </tr>
          </thead>
          <tbody>
            {org.leases.map((l) => (
              <tr key={l.id} className="border-b">
                <td className="py-1">{l.tenant.name}</td>
                <td className="py-1">
                  {l.unit.property.name} / {l.unit.label}
                </td>
                <td className="py-1">{money(l.monthlyRent)}</td>
                <td className="py-1">{l.status}</td>
              </tr>
            ))}
            {org.leases.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-gray-500">
                  No leases yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
