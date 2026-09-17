import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSession, requireStaff, canViewTenantPII } from "@/app/lib/auth";
import { requireModule } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import { updateLease } from "@/app/lib/actions";
import { LEASE_STATUSES } from "@/app/lib/constants";
import { maskTenantName } from "@/app/lib/tenant-privacy";

export default async function EditLeasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  requireModule(s, "leases");
  const { id } = await params;
  const { error } = await searchParams;
  const lease = await prisma.lease.findFirst({
    where: { id, organizationId: s.organizationId },
    include: { tenant: true, unit: { include: { property: true } } },
  });
  if (!lease) notFound();
  const piiVisible = canViewTenantPII(s.role);

  const [tenants, units] = await Promise.all([
    prisma.tenant.findMany({ where: { organizationId: s.organizationId }, orderBy: { name: "asc" } }),
    prisma.unit.findMany({ where: { organizationId: s.organizationId }, include: { property: true }, orderBy: { label: "asc" } }),
  ]);

  return (
    <div className="max-w-sm">
      <Link href={`/leases/${lease.id}`} className="text-xs underline text-silver-dark">
        Back to lease
      </Link>
      <h1 className="mt-1 text-lg font-semibold">Edit lease</h1>
      <p className="text-sm text-silver-dark">
        {maskTenantName(lease.tenant.name, piiVisible)} — {lease.unit.property.name} / {lease.unit.label}
      </p>
      {error && <div className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      <form action={updateLease.bind(null, lease.id)} className="mt-4 flex flex-col gap-3">
        <label className="text-xs text-silver-dark">
          Tenant
          <select name="tenantId" defaultValue={lease.tenantId} className="mt-1 block w-full rounded border px-3 py-2">
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {maskTenantName(t.name, piiVisible)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-silver-dark">
          Unit
          <select name="unitId" defaultValue={lease.unitId} className="mt-1 block w-full rounded border px-3 py-2">
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.property.name} / {u.label}
              </option>
            ))}
          </select>
        </label>
        <p className="-mt-1 text-xs text-silver-dark">
          For fixing a lease matched to the wrong person or unit — not for a genuine move. A real move keeps this
          lease&apos;s history on its own unit; add a new lease for the new one instead.
        </p>
        <input
          name="monthlyRent"
          type="number"
          step="0.01"
          required
          defaultValue={lease.monthlyRent}
          placeholder="Monthly rent"
          className="rounded border px-3 py-2"
        />
        <input
          name="startDate"
          type="date"
          required
          defaultValue={new Date(lease.startDate).toISOString().slice(0, 10)}
          className="rounded border px-3 py-2"
        />
        <input
          name="endDate"
          type="date"
          defaultValue={lease.endDate ? new Date(lease.endDate).toISOString().slice(0, 10) : ""}
          className="rounded border px-3 py-2"
        />
        <select name="status" defaultValue={lease.status} className="rounded border px-3 py-2">
          {LEASE_STATUSES.map((st) => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded bg-ink px-3 py-2 text-lily transition-colors hover:bg-ink-soft">
          Save changes
        </button>
      </form>
    </div>
  );
}
