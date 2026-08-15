import { redirect, notFound } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { updateLease } from "@/app/lib/actions";
import { LEASE_STATUSES } from "@/app/lib/constants";

export default async function EditLeasePage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  const { id } = await params;
  const lease = await prisma.lease.findFirst({
    where: { id, organizationId: s.organizationId },
    include: { tenant: true, unit: { include: { property: true } } },
  });
  if (!lease) notFound();

  return (
    <div className="max-w-sm">
      <h1 className="text-lg font-semibold">Edit lease</h1>
      <p className="text-sm text-silver-dark">
        {lease.tenant.name} — {lease.unit.property.name} / {lease.unit.label}
      </p>
      <form action={updateLease.bind(null, lease.id)} className="mt-4 flex flex-col gap-3">
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
