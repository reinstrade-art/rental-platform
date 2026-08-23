import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getProperties } from "@/app/lib/data";
import { createRepair } from "@/app/lib/actions";
import { REPAIR_PRIORITIES } from "@/app/lib/constants";
import { getOrgTier, hasFeature } from "@/app/lib/tier";

export default async function NewRepairPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  if (!hasFeature(await getOrgTier(s.organizationId), "REPAIRS")) redirect("/dashboard");
  const { error } = await searchParams;
  const properties = await getProperties(s.organizationId);

  return (
    <div className="max-w-sm">
      <Link href="/repairs" className="text-xs underline text-silver-dark">
        All repairs
      </Link>
      <h1 className="mt-1 text-lg font-semibold">Report a repair</h1>
      {error && <div className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      <form action={createRepair} className="mt-4 flex flex-col gap-3">
        <select name="propertyId" required className="rounded border px-3 py-2">
          <option value="">Select property</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select name="unitId" className="rounded border px-3 py-2">
          <option value="">No specific unit (common area)</option>
          {properties.flatMap((p) =>
            p.units.map((u) => (
              <option key={u.id} value={u.id}>
                {p.name} / {u.label}
              </option>
            )),
          )}
        </select>
        <input name="title" required placeholder="What's wrong (short title)" className="rounded border px-3 py-2" />
        <textarea name="description" placeholder="Description (optional)" className="rounded border px-3 py-2" />
        <input name="category" placeholder="Category (e.g. Plumbing)" className="rounded border px-3 py-2" />
        <select name="priority" defaultValue="NORMAL" className="rounded border px-3 py-2">
          {REPAIR_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded bg-ink px-3 py-2 text-lily transition-colors hover:bg-ink-soft">
          Report repair
        </button>
      </form>
    </div>
  );
}
