import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getRepairs } from "@/app/lib/data";
import { getOrgTier, hasFeature } from "@/app/lib/tier";
import { prisma } from "@/app/lib/prisma";
import { createRecurringJob, setRecurringJobActive, deleteRecurringJob } from "@/app/lib/actions";
import { DeleteButton } from "@/app/components/delete-button";

const PRIORITY_COLOR: Record<string, string> = {
  URGENT: "text-red-600",
  HIGH: "text-orange-600",
  NORMAL: "",
  LOW: "text-silver-dark",
};

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default async function RepairsPage() {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");

  const tier = await getOrgTier(s.organizationId);
  if (!hasFeature(tier, "REPAIRS")) redirect("/dashboard");
  const canRecur = hasFeature(tier, "RECURRING_JOBS");

  const [repairs, recurringJobs, properties, vendors] = await Promise.all([
    getRepairs(s.organizationId),
    canRecur
      ? prisma.recurringJob.findMany({
          where: { organizationId: s.organizationId },
          include: { property: true, vendor: true },
          orderBy: { title: "asc" },
        })
      : Promise.resolve([]),
    canRecur ? prisma.property.findMany({ where: { organizationId: s.organizationId }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    canRecur ? prisma.vendor.findMany({ where: { organizationId: s.organizationId }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Repairs</h1>
        <Link href="/repairs/new" className="rounded bg-ink px-3 py-1.5 text-sm text-lily transition-colors hover:bg-ink-soft">
          Report repair
        </Link>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
            <th className="py-2">Title</th>
            <th className="py-2">Property / Unit</th>
            <th className="py-2">Priority</th>
            <th className="py-2">Status</th>
            <th className="py-2">Vendor</th>
          </tr>
        </thead>
        <tbody>
          {repairs.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="py-2">
                <Link href={`/repairs/${r.id}`} className="underline">
                  {r.title}
                </Link>
              </td>
              <td className="py-2">
                {r.property.name}
                {r.unit ? ` / ${r.unit.label}` : ""}
              </td>
              <td className={`py-2 ${PRIORITY_COLOR[r.priority] ?? ""}`}>{r.priority}</td>
              <td className="py-2">{r.status}</td>
              <td className="py-2">
                {r.awardedVendor ? (
                  <Link href={`/vendors/${r.awardedVendor.id}`} className="underline">
                    {r.awardedVendor.name}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
          {repairs.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-silver-dark">
                No repairs reported yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {canRecur && (
        <details className="rounded border p-4">
          <summary className="cursor-pointer text-sm font-semibold">Recurring jobs ({recurringJobs.length})</summary>
          <p className="mt-2 text-xs text-silver-dark">
            A vendor job whose cost and frequency are already agreed — cleaning being the first of these. Raised
            automatically each day it falls due, already done, cost posted straight to Expenses — no quoting or
            approval loop.
          </p>

          {recurringJobs.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2">
              {recurringJobs.map((j) => (
                <li key={j.id} className={`flex flex-wrap items-center justify-between gap-3 rounded border px-3 py-2 text-sm ${j.active ? "" : "opacity-60"}`}>
                  <span>
                    <span className="font-medium">{j.title}</span>{" "}
                    <span className="text-xs text-silver-dark">
                      {j.property.name} · {j.vendor?.name ?? "no vendor set"} · every {j.frequencyDays} day{j.frequencyDays === 1 ? "" : "s"} · next{" "}
                      {new Date(j.nextDueAt).toLocaleDateString()}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="font-semibold">{money(j.cost)}</span>
                    <form action={setRecurringJobActive.bind(null, j.id, !j.active)}>
                      <button className="text-xs underline">{j.active ? "Pause" : "Resume"}</button>
                    </form>
                    <form action={deleteRecurringJob.bind(null, j.id)}>
                      <DeleteButton confirmText={`Remove the recurring job "${j.title}"?`} label="Remove" />
                    </form>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <form action={createRecurringJob} className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <input name="title" required placeholder="Job (e.g. Common areas cleaning)" className="rounded border px-3 py-2 text-sm lg:col-span-2" />
            <select name="propertyId" required className="rounded border px-3 py-2 text-sm">
              <option value="">Select property</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select name="vendorId" className="rounded border px-3 py-2 text-sm">
              <option value="">No vendor</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <input name="cost" type="number" step="0.01" required placeholder="Cost" className="rounded border px-3 py-2 text-sm" />
            <input name="frequencyDays" type="number" required defaultValue={30} placeholder="Every N days" className="rounded border px-3 py-2 text-sm" />
            <button type="submit" className="rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft sm:col-span-2 lg:col-span-1">
              Add recurring job
            </button>
          </form>
        </details>
      )}
    </div>
  );
}
