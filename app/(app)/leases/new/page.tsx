import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { createLease } from "@/app/lib/actions";
import { LeaseUnitSelect } from "@/app/components/lease-unit-select";

export default async function NewLeasePage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string; unitId?: string }>;
}) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  const { tenantId, unitId } = await searchParams;

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
      <h1 className="text-lg font-semibold">Add lease</h1>
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
        <select name="tenantId" required defaultValue={tenantId ?? ""} className="rounded border px-3 py-2">
          <option value="">Select tenant</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <input name="startDate" type="date" required className="rounded border px-3 py-2" />
        <button type="submit" className="rounded bg-ink px-3 py-2 text-lily transition-colors hover:bg-ink-soft">
          Add lease
        </button>
      </form>
    </div>
  );
}
