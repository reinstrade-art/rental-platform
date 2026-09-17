import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireStaff, canViewTenantPII } from "@/app/lib/auth";
import { maskTenantName } from "@/app/lib/tenant-privacy";
import { getRepairs, getRepairSummary, getProperties } from "@/app/lib/data";
import { getOrgTier, hasFeature } from "@/app/lib/tier";
import { getOpenApprovals } from "@/app/lib/approvals";
import { prisma } from "@/app/lib/prisma";
import { createRecurringJob, setRecurringJobActive, deleteRecurringJob, createRepair, acceptQuote } from "@/app/lib/actions";
import { DeleteButton } from "@/app/components/delete-button";
import { requireModule } from "@/app/lib/permissions";
import { REPAIR_PRIORITIES } from "@/app/lib/constants";

const OPEN_STATUSES = ["REPORTED", "QUOTING", "APPROVED", "IN_PROGRESS"];

const PRIORITY_TONE: Record<string, string> = {
  URGENT: "border-red-300 bg-red-50 text-red-700",
  HIGH: "border-orange-300 bg-orange-50 text-orange-700",
  NORMAL: "border-silver bg-silver-light text-ink",
  LOW: "border-silver bg-silver-light text-silver-dark",
};

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" | "gold" }) {
  const toneClass = tone === "bad" ? "text-red-600" : tone === "warn" ? "text-orange-600" : tone === "good" ? "text-green-700" : "text-gold";
  return (
    <div className="rounded border p-4">
      <div className="text-xs uppercase tracking-wide text-silver-dark">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-silver-dark">{sub}</div>}
    </div>
  );
}

export default async function RepairsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  requireModule(s, "repairs");
  const piiVisible = canViewTenantPII(s.role);

  const tier = await getOrgTier(s.organizationId);
  if (!hasFeature(tier, "REPAIRS")) redirect("/home");
  const canRecur = hasFeature(tier, "RECURRING_JOBS");
  const { error } = await searchParams;

  const [repairs, summary, properties, vendors, recurringJobs, openApprovals] = await Promise.all([
    getRepairs(s.organizationId),
    getRepairSummary(s.organizationId),
    getProperties(s.organizationId),
    prisma.vendor.findMany({ where: { organizationId: s.organizationId }, orderBy: { name: "asc" } }),
    canRecur
      ? prisma.recurringJob.findMany({
          where: { organizationId: s.organizationId },
          include: { property: true, vendor: true },
          orderBy: { title: "asc" },
        })
      : Promise.resolve([]),
    getOpenApprovals(s.organizationId),
  ]);

  // A repair with a QUOTE_AWARD request already pending shouldn't offer to
  // award again from the list — the office would just be asking twice for
  // the same signature chain.
  const awaitingAward = new Set(openApprovals.filter((a) => a.kind === "QUOTE_AWARD").map((a) => a.subjectId));
  const awaitingApproval = openApprovals.filter((a) => ["REPAIR_WORK", "REPAIR_COST", "QUOTE_AWARD"].includes(a.kind)).length;

  const open = repairs.filter((r) => OPEN_STATUSES.includes(r.status));
  const closed = repairs.filter((r) => !OPEN_STATUSES.includes(r.status));
  const urgentOpen = open.filter((r) => r.priority === "URGENT").length;

  const row = (r: (typeof repairs)[number]) => {
    const acceptedQuote = r.quotes.find((q) => q.status === "ACCEPTED");
    const est = r.approvedCost ?? acceptedQuote?.amount ?? (r.quotes.length ? Math.min(...r.quotes.map((q) => q.amount)) : null);
    const closedRow = r.status === "DONE" || r.status === "CANCELLED";
    const awardable = closedRow || awaitingAward.has(r.id) ? [] : r.quotes.filter((q) => q.status === "SUBMITTED");
    const soleAward = awardable.length === 1 ? awardable[0] : null;

    return (
      <tr key={r.id} className="border-b">
        <td className="py-2">
          <Link href={`/repairs/${r.id}`} className="font-medium underline">
            {r.title}
          </Link>
          <div className="text-xs text-silver-dark">
            {r.property.name}
            {r.unit ? ` · ${r.unit.label}` : " · common area"} · {new Date(r.reportedAt).toLocaleDateString()}
            {r.reportedByTenant ? ` · tenant ${maskTenantName(r.reportedByTenant.name, piiVisible)}` : ""}
          </div>
        </td>
        <td className="py-2">
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${PRIORITY_TONE[r.priority] ?? PRIORITY_TONE.NORMAL}`}>
            {r.priority}
          </span>
        </td>
        <td className="py-2">
          {r.awardedVendor ? (
            <Link href={`/vendors/${r.awardedVendor.id}`} className="underline">
              {r.awardedVendor.name}
            </Link>
          ) : (
            <span className="text-silver-dark">unassigned</span>
          )}
        </td>
        <td className="py-2 text-right">
          {r.finalCost != null ? money(r.finalCost) : est != null ? <span className="text-silver-dark">~{money(est)}</span> : "—"}
        </td>
        <td className="py-2">{r.status}</td>
        <td className="py-2 text-right">
          {soleAward && (
            <form action={acceptQuote.bind(null, r.id, soleAward.id)} className="inline">
              <button type="submit" className="rounded border border-gold px-2 py-1 text-xs font-medium text-ink transition-colors hover:bg-silver-light" title={`Award to ${money(soleAward.amount)}`}>
                Award
              </button>
            </form>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="flex flex-col gap-8">
      {error && <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div>
        <h1 className="text-lg font-semibold">Repairs</h1>
        <p className="text-xs text-silver-dark">Reported by tenants or the office, then quoted, approved and completed.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Open jobs" value={String(summary.pendingCount)} sub={urgentOpen ? `${urgentOpen} urgent` : "none urgent"} tone={urgentOpen ? "bad" : summary.pendingCount ? "warn" : "good"} />
        <StatCard label="Pending cost" value={money(summary.pendingCost)} sub="Approved or quoted" tone="gold" />
        <StatCard label="Completed" value={String(summary.doneCount)} sub="All time" tone="good" />
        <StatCard label="Spent on repairs" value={money(summary.doneCost)} sub="Completed jobs" tone="gold" />
      </div>

      {awaitingApproval > 0 && (
        <p className="rounded border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-700">
          {awaitingApproval} job{awaitingApproval === 1 ? "" : "s"} waiting on approval — work and cost are signed off separately.{" "}
          <Link href="/approvals" className="underline">
            See approvals
          </Link>
          .
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-silver-dark">Open ({open.length})</h2>
            {open.length === 0 ? (
              <p className="rounded border p-4 text-sm text-silver-dark">Nothing outstanding.</p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
                    <th className="py-2">Job</th>
                    <th className="py-2">Priority</th>
                    <th className="py-2">Vendor</th>
                    <th className="py-2 text-right">Cost</th>
                    <th className="py-2">Status</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>{open.map(row)}</tbody>
              </table>
            )}
          </div>

          {closed.length > 0 && (
            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-silver-dark">Closed ({closed.length})</h2>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
                    <th className="py-2">Job</th>
                    <th className="py-2">Priority</th>
                    <th className="py-2">Vendor</th>
                    <th className="py-2 text-right">Cost</th>
                    <th className="py-2">Status</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>{closed.map(row)}</tbody>
              </table>
            </div>
          )}
        </div>

        <div className="h-fit rounded border p-4">
          <h2 className="mb-3 font-semibold">Report a repair</h2>
          {properties.length === 0 ? (
            <p className="text-sm text-silver-dark">Add a property first, then faults can be logged against it.</p>
          ) : (
            <form action={createRepair} className="flex flex-col gap-3">
              <input name="title" required placeholder="What's wrong (short title)" className="rounded border px-3 py-2 text-sm" />
              <select name="propertyId" required defaultValue="" className="rounded border px-3 py-2 text-sm">
                <option value="" disabled>
                  Select property…
                </option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select name="unitId" defaultValue="" className="rounded border px-3 py-2 text-sm">
                <option value="">Common area (no specific unit)</option>
                {properties.flatMap((p) =>
                  p.units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {p.name} · {u.label}
                    </option>
                  )),
                )}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input name="category" placeholder="Category (e.g. Plumbing)" className="rounded border px-3 py-2 text-sm" />
                <select name="priority" defaultValue="NORMAL" className="rounded border px-3 py-2 text-sm">
                  {REPAIR_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <textarea name="description" rows={3} placeholder="Details (optional)" className="rounded border px-3 py-2 text-sm" />
              <button type="submit" className="rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
                Log repair
              </button>
            </form>
          )}
        </div>
      </div>

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
