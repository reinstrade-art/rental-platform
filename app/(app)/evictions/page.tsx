import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getEvictions } from "@/app/lib/data";
import { GROUNDS, STATUS_LABEL, OPEN_STATUSES, splitGrounds } from "@/app/lib/eviction";
import { getOrgTier, hasFeature } from "@/app/lib/tier";
import { requireModule } from "@/app/lib/permissions";
import { tenantView } from "@/app/lib/pii";
import { prisma } from "@/app/lib/prisma";
import { issueWarningAction } from "@/app/lib/actions";
import { getRecentWarnings, getReadyForNotice, WARNING_GROUNDS, KIND_LABEL } from "@/app/lib/warnings";
import { GROUNDS_LIST } from "@/app/lib/eviction";

export default async function EvictionsPage({ searchParams }: { searchParams: Promise<{ error?: string; warned?: string }> }) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  if (!hasFeature(await getOrgTier(s.organizationId), "EVICTIONS")) redirect("/home");
  requireModule(s, "evictions");
  const v = tenantView(s); // surnames masked below manager/director/admin
  const { error, warned } = await searchParams;
  const evictions = await getEvictions(s.organizationId);
  const [warnings, ready, activeLeases] = await Promise.all([
    getRecentWarnings(s.organizationId),
    getReadyForNotice(s.organizationId),
    // Only those allowed to issue a warning need the tenant picker.
    v.visible
      ? prisma.lease.findMany({
          where: { organizationId: s.organizationId, status: "ACTIVE" },
          include: { tenant: { select: { name: true } }, unit: { select: { label: true, property: { select: { name: true } } } } },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
  ]);

  const open = evictions.filter((e) => OPEN_STATUSES.includes(e.status));
  const closed = evictions.filter((e) => !OPEN_STATUSES.includes(e.status));
  const now = new Date();

  return (
    <div className="flex flex-col gap-8">
      {error && <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div>
        <h1 className="text-lg font-semibold">Evictions</h1>
        <p className="text-sm text-silver-dark">
          Every case tracked through the process the law sets — never a lock changed without a court order. See a
          tenancy&apos;s own page to start a case.
        </p>
      </div>

      <div className="rounded border border-t-2 border-t-gold bg-silver-light p-4 text-xs text-silver-dark">
        Self-help eviction — changing locks, removing doors or roofing, cutting water or power, or seizing
        belongings without a court bailiff — is illegal in Kenya. Every case here runs through notice, then the
        tribunal or court, then enforcement by a court officer.
      </div>

      {warned && (
        <div
          className={`rounded border px-4 py-3 text-sm ${
            warned === "sent" ? "border-green-300 bg-green-50 text-green-700" : "border-orange-300 bg-orange-50 text-orange-800"
          }`}
        >
          {warned === "sent"
            ? "Warning letter created and delivered to the tenant."
            : "Warning letter created, but it could not be delivered electronically (no working email, phone or app on file). Print it from the list below and serve it by hand or registered post."}
        </div>
      )}

      <div>
        <h2 className="font-semibold">Warnings — the step before an eviction</h2>
        <p className="mt-1 max-w-3xl text-sm text-silver-dark">
          A written final warning, with a clear deadline and a record of delivery, comes before any Notice to Vacate. The
          system sends one automatically to tenants a month behind on rent (see Settings), and a manager can issue one for
          any ground below. Nothing here starts an eviction — that stays your decision.
        </p>

        {ready.length > 0 && (
          <div className="mt-3 rounded border border-orange-300 bg-orange-50 p-4">
            <h3 className="text-sm font-semibold text-orange-800">Ready for a Notice to Vacate ({ready.length})</h3>
            <p className="text-xs text-orange-800">Warned, the deadline has passed, and the problem is still there. Whether to serve a notice is for you to decide.</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {ready.map(({ warning: w, owed }) => (
                <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    <span className="font-medium">{v.name(w.lease.tenant.name)}</span>
                    <span className="ml-1 text-xs text-silver-dark">
                      {w.lease.unit.property.name} / {w.lease.unit.label} · deadline was {new Date(w.complyBy).toLocaleDateString()}
                      {owed ? ` · owes KES ${Math.round(owed).toLocaleString()}` : ""}
                    </span>
                  </span>
                  <Link href={`/leases/${w.leaseId}`} className="text-xs underline">
                    Open lease to start a Notice to Vacate
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {v.visible && (
          <details className="mt-3 max-w-2xl rounded border p-4">
            <summary className="cursor-pointer text-sm font-medium">Issue a warning</summary>
            <form action={issueWarningAction} className="mt-3 flex flex-col gap-3">
              <label className="text-xs text-silver-dark">
                Tenant
                <select name="leaseId" required className="mt-1 w-full rounded border px-3 py-2 text-sm text-ink">
                  <option value="">Select a tenant…</option>
                  {activeLeases.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.tenant.name} — {l.unit.property.name} / {l.unit.label}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend className="text-xs text-silver-dark">Ground(s)</legend>
                <div className="mt-1 flex flex-col gap-1.5">
                  {GROUNDS_LIST.map((g) => (
                    <label key={g} className="flex items-start gap-2 text-sm">
                      <input type="checkbox" name={`ground_${g}`} className="mt-1" />
                      <span>
                        {WARNING_GROUNDS[g].title}
                        <span className="ml-1 text-xs text-silver-dark">
                          {WARNING_GROUNDS[g].fault ? "— final warning" : "— advance notice, no fault"}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-silver-dark">Pick fault grounds or no-fault grounds, not both — they are different letters.</p>
              </fieldset>
              <label className="text-xs text-silver-dark">
                What happened (required for breach, nuisance and damage — it is printed in the letter)
                <textarea name="details" rows={3} className="mt-1 w-full rounded border px-3 py-2 text-sm text-ink" />
              </label>
              <label className="text-xs text-silver-dark">
                Days to put it right (final warning: 1–60; suggested 7 for arrears, 14 for breach or damage, 3 for nuisance) —
                or, for a no-fault notice, days until the tenancy ends (at least 30; suggested 60)
                <input name="days" type="number" min={1} max={365} defaultValue={7} required className="mt-1 w-32 rounded border px-3 py-2 text-sm text-ink" />
              </label>
              <p className="text-xs text-silver-dark">
                The letter is generated and sent straight away by email, SMS or WhatsApp and app notification — wherever the
                tenant can be reached — and recorded with proof of delivery. Have an advocate review the wording before you
                rely on it.
              </p>
              <button type="submit" className="self-start rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
                Generate and send
              </button>
            </form>
          </details>
        )}

        {warnings.length > 0 && (
          <table className="mt-4 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
                <th className="py-2">Issued</th>
                <th className="py-2">Tenant</th>
                <th className="py-2">Letter</th>
                <th className="py-2">Comply by</th>
                <th className="py-2">Delivery</th>
                <th className="py-2">Read</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {warnings.map((w) => (
                <tr key={w.id} className="border-b align-top">
                  <td className="py-2 text-xs text-silver-dark">
                    {new Date(w.createdAt).toLocaleDateString()}
                    <span className="block">{w.source === "AUTO" ? "automatic" : "by the office"}</span>
                  </td>
                  <td className="py-2">
                    {v.name(w.lease.tenant.name)}
                    <span className="block text-xs text-silver-dark">
                      {w.lease.unit.property.name} / {w.lease.unit.label}
                    </span>
                  </td>
                  <td className="py-2">
                    {KIND_LABEL[w.kind] ?? w.kind}
                    <span className="block text-xs text-silver-dark">
                      {w.grounds
                        .split(",")
                        .map((g) => WARNING_GROUNDS[g as keyof typeof WARNING_GROUNDS]?.title ?? g)
                        .join("; ")}
                    </span>
                  </td>
                  <td className="py-2">{new Date(w.complyBy).toLocaleDateString()}</td>
                  <td className={`py-2 text-xs ${w.deliveredAt ? "" : "font-medium text-red-600"}`}>
                    {w.deliveredAt ? `via ${w.channels.split(",").join(", ")}` : "Not delivered — serve by hand"}
                  </td>
                  <td className="py-2 text-xs text-silver-dark">{w.viewedAt ? new Date(w.viewedAt).toLocaleDateString() : "—"}</td>
                  <td className="py-2">
                    {v.visible && (
                      <a href={`/api/warning/${w.id}`} target="_blank" rel="noreferrer" className="text-xs underline">
                        View letter
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <h2 className="font-semibold">Open ({open.length})</h2>
        {open.length === 0 ? (
          <p className="mt-2 text-sm text-silver-dark">No open cases.</p>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            {open.map((e) => {
              const codes = splitGrounds(e.grounds);
              const overdue = e.status === "NOTICE_SERVED" && e.noticeDeadline && new Date(e.noticeDeadline) < now;
              return (
                <Link
                  key={e.id}
                  href={`/evictions/${e.id}`}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded border px-4 py-3 text-sm transition-colors hover:bg-silver-light ${
                    overdue ? "border-red-300 bg-red-50" : ""
                  }`}
                >
                  <span>
                    <span className="block font-medium">{v.name(e.lease.tenant.name)}</span>
                    <span className="block text-xs text-silver-dark">
                      {e.lease.unit.property.name} · Unit {e.lease.unit.label} · {codes.map((c) => GROUNDS[c].label).join("; ")}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {overdue && <span className="text-xs font-medium text-red-600">notice period expired</span>}
                    <span className="rounded-full border px-2.5 py-1 text-xs font-medium">{STATUS_LABEL[e.status] ?? e.status}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {closed.length > 0 && (
        <div>
          <h2 className="font-semibold">Closed ({closed.length})</h2>
          <div className="mt-2 flex flex-col gap-2">
            {closed.map((e) => (
              <Link
                key={e.id}
                href={`/evictions/${e.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded border px-4 py-3 text-sm opacity-70 transition-opacity hover:opacity-100 hover:bg-silver-light"
              >
                <span>
                  <span className="block font-medium">{v.name(e.lease.tenant.name)}</span>
                  <span className="block text-xs text-silver-dark">
                    {e.lease.unit.property.name} · Unit {e.lease.unit.label}
                  </span>
                </span>
                <span className="rounded-full border px-2.5 py-1 text-xs font-medium">{STATUS_LABEL[e.status] ?? e.status}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
