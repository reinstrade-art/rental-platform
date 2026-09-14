import { redirect } from "next/navigation";
import { AppShell } from "@/app/components/app-shell";
import { getSession, requireTenantsAccess } from "@/app/lib/auth";
import { isTenant, isTradesman, isCaretaker } from "@/app/lib/roles";
import { logout, endImpersonationAction } from "@/app/lib/actions";
import { prisma } from "@/app/lib/prisma";
import { licenseState } from "@/app/lib/licensing";
import { hasFeature, type Feature } from "@/app/lib/tier";
import { getArrearsAlerts } from "@/app/lib/alerts";
import { hasModuleAccess } from "@/app/lib/permissions";
import { MODULE_LIST, type ModuleKey } from "@/app/lib/constants";
import { PushRegistration } from "@/app/components/push-registration";

const NAV: { href: string; label: string; feature?: Feature }[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/properties", label: "Properties" },
  { href: "/tenants", label: "Tenants" },
  { href: "/leases", label: "Leases" },
  { href: "/messages", label: "Messages" },
  { href: "/alerts", label: "Alerts", feature: "ARREARS_ALERTS" },
  { href: "/evictions", label: "Evictions", feature: "EVICTIONS" },
  { href: "/payments", label: "Payments" },
  { href: "/expenses", label: "Expenses", feature: "EXPENSES" },
  { href: "/repairs", label: "Repairs", feature: "REPAIRS" },
  { href: "/vendors", label: "Vendors", feature: "REPAIRS" },
  { href: "/suppliers", label: "Suppliers", feature: "SUPPLIERS" },
  { href: "/reports", label: "Reports", feature: "REPORTS" },
  { href: "/approvals", label: "Approvals" },
  { href: "/users", label: "Team" },
  { href: "/settings", label: "Settings" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/login");
  // Skipped while impersonated: the person actually at the keyboard is staff
  // or a platform admin doing support, not the account holder — they don't
  // know this account's temporary password and have no business setting a
  // new one on someone else's behalf just to view their data.
  if (s.mustChangePassword && !s.impersonatedBy) redirect("/change-password");
  if (!requireTenantsAccess(s)) {
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
  // A caretaker's whole nav is the one module they're let into — every other
  // page in the app still gates on requireStaff alone, so this trimmed list
  // is a convenience, not the actual security boundary.
  const moduleForHref = (href: string): ModuleKey | undefined =>
    (MODULE_LIST as readonly string[]).includes(href.slice(1)) ? (href.slice(1) as ModuleKey) : undefined;
  const nav = isCaretaker(s.role)
    ? NAV.filter((item) => item.href === "/tenants")
    : NAV.filter((item) => !item.feature || hasFeature(tier, item.feature)).filter((item) => {
        const mod = moduleForHref(item.href);
        return !mod || hasModuleAccess(s, mod);
      });

  // Only fetched when the Alerts nav item is actually showing -- gated
  // behind hasFeature the same way the item itself is, so an org without
  // ARREARS_ALERTS never pays for a query whose result it'd never see.
  const hasActiveAlerts =
    nav.some((item) => item.href === "/alerts") && (await getArrearsAlerts(s.organizationId)).length > 0;
  const navWithAttention = nav.map((item) => ({ ...item, attention: item.href === "/alerts" && hasActiveAlerts }));

  return (
    <AppShell orgName={org?.name ?? "Organization"} nav={navWithAttention} logoutAction={logout}>
      <PushRegistration />
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
    </AppShell>
  );
}
