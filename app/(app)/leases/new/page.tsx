import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { createLease } from "@/app/lib/actions";

export default async function NewLeasePage() {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");

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
        <select name="unitId" required className="rounded border px-3 py-2">
          <option value="">Select unit</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.property.name} / {u.label}
            </option>
          ))}
        </select>
        <select name="tenantId" required className="rounded border px-3 py-2">
          <option value="">Select tenant</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <input
          name="monthlyRent"
          type="number"
          step="0.01"
          required
          placeholder="Monthly rent"
          className="rounded border px-3 py-2"
        />
        <input name="startDate" type="date" required className="rounded border px-3 py-2" />
        <button type="submit" className="rounded bg-black px-3 py-2 text-white">
          Add lease
        </button>
      </form>
    </div>
  );
}
