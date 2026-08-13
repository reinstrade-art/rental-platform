import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession, requireStaff } from "@/app/lib/auth";
import { isTenant, isTradesman } from "@/app/lib/roles";
import { logout, endImpersonationAction } from "@/app/lib/actions";
import { prisma } from "@/app/lib/prisma";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/properties", label: "Properties" },
  { href: "/tenants", label: "Tenants" },
  { href: "/leases", label: "Leases" },
  { href: "/payments", label: "Payments" },
  { href: "/repairs", label: "Repairs" },
  { href: "/vendors", label: "Vendors" },
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

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 bg-ink px-4 py-6 text-lily">
        <div className="mb-6 border-l-2 border-gold pl-2 font-semibold tracking-tight">
          {org?.name ?? "Organization"}
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
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
        <main className="px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
