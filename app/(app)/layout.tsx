import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession, requireStaff } from "@/app/lib/auth";
import { isTenant, isTradesman } from "@/app/lib/roles";
import { logout, endImpersonationAction } from "@/app/lib/actions";
import { prisma } from "@/app/lib/prisma";
import { licenseState } from "@/app/lib/licensing";
import { hasFeature, type Feature } from "@/app/lib/tier";

const NAV: { href: string; label: string; feature?: Feature }[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/properties", label: "Properties" },
  { href: "/tenants", label: "Tenants" },
  { href: "/leases", label: "Leases" },
  { href: "/alerts", label: "Alerts", feature: "ARREARS_ALERTS" },
  { href: "/evictions", label: "Evictions", feature: "EVICTIONS" },
  { href: "/payments", label: "Payments" },
  { href: "/expenses", label: "Expenses", feature: "EXPENSES" },
  { href: "/repairs", label: "Repairs", feature: "REPAIRS" },
  { href: "/vendors", label: "Vendors", feature: "REPAIRS" },
  { href: "/approvals", label: "Approvals" },
  { href: "/users", label: "Team" },
  { href: "/settings", label: "Settings" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!requireStaff(s)) {
    // An outside role landing here (e.g. a stale bookmark) goes to their own
    // home, not to a login wall they'd just bounce off again — but nothing
    // about this branch grants them anything beyond their own portal.
    if (isTenant(s.role)) redirect("/portal");
    if (isTradesman(s.role)) redirect("/trade");
    redirect("/login");
  }

  const org = await prisma.organization.findUnique({ where: { id: s.organizationId } });
  // Reaching this layout already proves the license is active — getSession()
  // blocks login otherwise — so this is purely an advance warning, shown
  // only in the final week of a trial or a paid license, not a gate itself.
  const license = org ? licenseState(org) : null;
  const showLicenseWarning = license && license.state !== "EXPIRED" && license.daysLeft !== null && license.daysLeft <= 7;
  const tier = org?.tier ?? "BASIC";
  const nav = NAV.filter((item) => !item.feature || hasFeature(tier, item.feature));

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col bg-ink-photo text-lily">
        <div className="h-1 shrink-0 bg-metal" />
        <div className="flex-1 px-4 py-6">
          <div className="mb-6 border-l-2 border-gold pl-2 font-semibold tracking-tight">
            {org?.name ?? "Organization"}
          </div>
          <nav className="flex flex-col gap-1">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded px-2 py-1.5 text-sm text-lily/85 transition-colors hover:bg-ink-soft hover:text-gold"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <form action={logout} className="mt-6">
            <button className="text-sm text-silver underline hover:text-gold">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="flex-1">
        {s.impersonatedBy && (
          <div className="flex items-center justify-between border-b border-silver bg-silver-light px-6 py-2 text-sm text-ink">
            <span>
              Signed in as <strong>{s.email ?? s.phone}</strong> by {s.impersonatedBy.email} for support.
            </span>
            <form action={endImpersonationAction}>
              <button className="underline">Return to my account</button>
            </form>
          </div>
        )}
        {showLicenseWarning && (
          <div className="border-b border-orange-300 bg-orange-50 px-6 py-2 text-sm font-medium text-orange-800">
            {license!.state === "TRIAL"
              ? `Your trial ends in ${license!.daysLeft} day${license!.daysLeft === 1 ? "" : "s"}. Contact us to license this account and avoid losing access.`
              : `Your license expires in ${license!.daysLeft} day${license!.daysLeft === 1 ? "" : "s"}. Renew to avoid losing access.`}
          </div>
        )}
        <main className="px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
