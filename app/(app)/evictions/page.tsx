import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireStaff, canViewTenantPII } from "@/app/lib/auth";
import { getEvictions } from "@/app/lib/data";
import { GROUNDS, STATUS_LABEL, OPEN_STATUSES, splitGrounds } from "@/app/lib/eviction";
import { getOrgTier, hasFeature } from "@/app/lib/tier";
import { requireModule } from "@/app/lib/permissions";
import { maskTenantName } from "@/app/lib/tenant-privacy";

export default async function EvictionsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  if (!hasFeature(await getOrgTier(s.organizationId), "EVICTIONS")) redirect("/home");
  requireModule(s, "evictions");
  const piiVisible = canViewTenantPII(s.role);
  const { error } = await searchParams;
  const evictions = await getEvictions(s.organizationId);

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
                    <span className="block font-medium">{maskTenantName(e.lease.tenant.name, piiVisible)}</span>
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
                  <span className="block font-medium">{maskTenantName(e.lease.tenant.name, piiVisible)}</span>
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
