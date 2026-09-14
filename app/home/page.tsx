import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { getDashboard, getBilledVsCollected } from "@/app/lib/data";
import { getOpenApprovals } from "@/app/lib/approvals";
import { HomeTabs } from "./home-tabs";

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

const KIND_LABEL: Record<string, string> = {
  REPAIR_WORK: "Repair work",
  REPAIR_COST: "Repair cost",
  QUOTE_AWARD: "Quote award",
  PAYMENT_OUT: "Expense",
};

export default async function HomePage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!requireStaff(s)) redirect("/login");

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [dash, trend, expensesThisMonth, openApprovals, activeLeases, vacantUnit, org] = await Promise.all([
    getDashboard(s.organizationId),
    getBilledVsCollected(s.organizationId, now.getUTCFullYear()),
    prisma.expense.aggregate({ where: { organizationId: s.organizationId, paidAt: { gte: monthStart } }, _sum: { amount: true } }),
    getOpenApprovals(s.organizationId),
    prisma.lease.findMany({
      where: { organizationId: s.organizationId, status: "ACTIVE" },
      include: { charges: true, payments: true, tenant: true, unit: { include: { property: true } } },
    }),
    prisma.unit.findFirst({
      where: { organizationId: s.organizationId, leases: { none: { status: "ACTIVE" } } },
      include: { property: true },
    }),
    prisma.organization.findUnique({ where: { id: s.organizationId }, select: { name: true } }),
  ]);

  const noi = dash.received - (expensesThisMonth._sum.amount ?? 0);
  const priorMonthCollected = trend[now.getUTCMonth() - 1]?.collected ?? 0;
  const noiChangePct = priorMonthCollected > 0 ? Math.round(((dash.received - priorMonthCollected) / priorMonthCollected) * 100) : null;
  const occupancyPct = dash.unitCount > 0 ? Math.round((dash.occupiedUnits / dash.unitCount) * 100) : 0;
  const collectedPct = dash.billed > 0 ? Math.round((dash.received / dash.billed) * 100) : dash.received > 0 ? 100 : 0;
  const sparkline = trend.slice(0, now.getUTCMonth() + 1).slice(-8);
  const sparkPeak = Math.max(...sparkline.map((m) => m.collected), 1);

  // "Needs You": whatever's most pressing across approvals, arrears, and
  // vacancy — capped at three, same three kinds the design calls out, but
  // built from what's actually on file rather than fixed sample rows.
  type NeedsItem = { href: string; icon: "wrench" | "clock" | "home"; title: string; subtitle: string };
  const items: NeedsItem[] = [];

  if (openApprovals.length > 0) {
    const a = openApprovals[0];
    let subject = "";
    if (a.kind === "REPAIR_WORK" || a.kind === "REPAIR_COST" || a.kind === "QUOTE_AWARD") {
      const repair = await prisma.repair.findFirst({ where: { id: a.subjectId }, select: { title: true } });
      subject = repair?.title ?? "";
    }
    let amount: number | null = null;
    try {
      const payload = a.payload ? JSON.parse(a.payload) : null;
      amount = typeof payload?.approvedCost === "number" ? payload.approvedCost : null;
    } catch {
      amount = null;
    }
    items.push({
      href: "/approvals",
      icon: "wrench",
      title: subject || `${KIND_LABEL[a.kind] ?? "Approval"}${amount != null ? `, KES ${money(amount)}` : ""}`,
      subtitle: `${KIND_LABEL[a.kind] ?? "Approval"} · awaiting your approval`,
    });
  }

  const mostOverdue = activeLeases
    .map((l) => {
      const balance = l.charges.reduce((sum, c) => sum + c.amount, 0) - l.payments.reduce((sum, p) => sum + p.amount, 0);
      const oldest = [...l.charges].sort((a, b) => a.periodMonth.getTime() - b.periodMonth.getTime())[0];
      const days = oldest ? Math.max(0, Math.floor((now.getTime() - oldest.periodMonth.getTime()) / 864e5)) : 0;
      return { lease: l, balance, days };
    })
    .filter((x) => x.balance > 0)
    .sort((a, b) => b.balance - a.balance)[0];
  if (mostOverdue) {
    items.push({
      href: `/tenants/${mostOverdue.lease.tenantId}`,
      icon: "clock",
      title: `${mostOverdue.lease.tenant.name} owes KES ${money(mostOverdue.balance)}`,
      subtitle: `${mostOverdue.lease.unit.property.name} · ${mostOverdue.lease.unit.label} — a gentle reminder queued`,
    });
  }

  if (vacantUnit) {
    items.push({
      href: `/properties/${vacantUnit.property.id}`,
      icon: "home",
      title: `${vacantUnit.property.name} ${vacantUnit.label} vacant`,
      subtitle: `Listed at KES ${money(vacantUnit.monthlyRent ?? 0)}`,
    });
  }

  return (
    <div className="min-h-screen bg-lily pb-24 text-ink">
      <div className="mx-auto max-w-md px-5 pt-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-silver-dark">
              Reins Realty · Owner app
            </div>
            <img src="/logo.svg" alt="Reins Realty" className="mt-1 h-10" />
          </div>
          <div className="flex items-center gap-2">
            <Link href="/leases/billing-run" aria-label="Billing run" className="rounded-lg border border-silver p-2 text-silver-dark hover:text-gold">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
            </Link>
            <Link href="/alerts" aria-label="Alerts" className="relative rounded-lg border border-silver p-2 text-silver-dark hover:text-gold">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </Link>
          </div>
        </div>

        <h1 className="mt-5 text-2xl font-semibold">Welcome</h1>
        <p className="text-xs text-silver-dark">{org?.name}</p>

        <HomeTabs
          noi={noi}
          noiChangePct={noiChangePct}
          period={monthStart}
          sparkline={sparkline}
          sparkPeak={sparkPeak}
          occupancyPct={occupancyPct}
          occupiedUnits={dash.occupiedUnits}
          unitCount={dash.unitCount}
          collectedPct={collectedPct}
          received={dash.received}
          grossArrears={dash.grossArrears}
        />

        {items.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-silver-dark">Needs you</h2>
              <span className="text-xs text-silver-dark">{items.length} item{items.length === 1 ? "" : "s"}</span>
            </div>
            <div className="mt-2 flex flex-col gap-2">
              {items.map((it, i) => (
                <Link
                  key={i}
                  href={it.href}
                  className="flex items-center gap-3 rounded-xl border border-silver bg-silver-light px-3.5 py-3 transition-colors hover:border-accent"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                    {it.icon === "wrench" && (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14.7 6.3a4 4 0 0 1-5.4 5.4l-6 6a1.5 1.5 0 0 0 2.1 2.1l6-6a4 4 0 0 1 5.4-5.4l-2.6 2.6-2-2 2.5-2.7z" />
                      </svg>
                    )}
                    {it.icon === "clock" && (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v5l3 3" />
                      </svg>
                    )}
                    {it.icon === "home" && (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 10.5 12 3l9 7.5" />
                        <path d="M5 9.5V21h14V9.5" />
                      </svg>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{it.title}</span>
                    <span className="block truncate text-xs text-silver-dark">{it.subtitle}</span>
                  </span>
                  <span className="text-silver-dark">›</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-silver-dark">Portfolio</h2>
          <p className="mt-2 text-xs text-silver-dark">
            This is the quick view. Everything below opens into the full app, exactly as it works today.
          </p>
        </div>
      </div>

      {/* Bottom nav — every icon leads into the existing app, unchanged. */}
      <nav className="fixed inset-x-0 bottom-0 border-t border-silver bg-silver-light">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {[
            { href: "/dashboard", label: "Portfolio", active: true, d: "M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" },
            { href: "/payments", label: "Rent", active: false, d: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" },
            { href: "/repairs", label: "Work", active: false, d: "M14.7 6.3a4 4 0 0 1-5.4 5.4l-6 6a1.5 1.5 0 0 0 2.1 2.1l6-6a4 4 0 0 1 5.4-5.4l-2.6 2.6-2-2 2.5-2.7z" },
            { href: "/messages", label: "Inbox", active: false, d: "M4 4h16v16H4zM4 6l8 7 8-7" },
            { href: "/reports", label: "Docs", active: false, d: "M6 2h9l5 5v15H6zM14 2v6h6M8 13h8M8 17h8" },
          ].map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`flex flex-col items-center gap-1 py-2.5 text-[10px] ${n.active ? "text-accent" : "text-silver-dark hover:text-ink"}`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d={n.d} />
              </svg>
              {n.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
