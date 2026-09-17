import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireStaff, canViewTenantPII } from "@/app/lib/auth";
import { requireModule } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import { createLease } from "@/app/lib/actions";
import { LeaseUnitSelect } from "@/app/components/lease-unit-select";
import { maskTenantName } from "@/app/lib/tenant-privacy";

export default async function NewLeasePage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string; unitId?: string; error?: string }>;
}) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  requireModule(s, "leases");
  const piiVisible = canViewTenantPII(s.role);
  const { tenantId, unitId, error } = await searchParams;

  const [units, tenants] = await Promise.all([
    prisma.unit.findMany({
      where: { organizationId: s.organizationId },
      include: { property: true },
      orderBy: { label: "asc" },
    }),
    prisma.tenant.findMany({ where: { organizationId: s.organizationId }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="max-w-sm">
      <Link href="/leases" className="text-xs underline text-silver-dark">
        All leases
      </Link>
      <h1 className="mt-1 text-lg font-semibold">Add lease</h1>
      {error && <div className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      <form action={createLease} className="mt-4 flex flex-col gap-3">
        <LeaseUnitSelect
          units={units.map((u) => ({
            id: u.id,
            label: u.label,
            propertyName: u.property.name,
            monthlyRent: u.monthlyRent,
          }))}
          defaultUnitId={unitId}
        />
        <select name="tenantId" defaultValue={tenantId ?? ""} className="rounded border px-3 py-2">
          <option value="">Select an existing tenant…</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {maskTenantName(t.name, piiVisible)}
            </option>
          ))}
        </select>
        <p className="text-center text-xs text-silver-dark">— or, for someone not in the system yet —</p>
        <input name="newTenantName" placeholder="New tenant's full name" className="rounded border px-3 py-2" />
        <div className="flex gap-2">
          <input name="newTenantPhone" placeholder="Phone (optional)" className="flex-1 rounded border px-3 py-2" />
          <input name="newTenantEmail" type="email" placeholder="Email (optional)" className="flex-1 rounded border px-3 py-2" />
        </div>
        <input name="startDate" type="date" required className="rounded border px-3 py-2" />
        <button type="submit" className="rounded bg-ink px-3 py-2 text-lily transition-colors hover:bg-ink-soft">
          Add lease
        </button>
      </form>
    </div>
  );
}
