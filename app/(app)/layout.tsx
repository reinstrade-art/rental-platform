import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession, requireStaff } from "@/app/lib/auth";
import { isTenant, isTradesman } from "@/app/lib/roles";
import { logout } from "@/app/lib/actions";
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
      <aside className="w-56 shrink-0 border-r px-4 py-6">
        <div className="mb-6 font-semibold">{org?.name ?? "Organization"}</div>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="rounded px-2 py-1.5 text-sm hover:bg-gray-100">
              {item.label}
            </Link>
          ))}
        </nav>
        <form action={logout} className="mt-6">
          <button className="text-sm text-gray-600 underline">Sign out</button>
        </form>
      </aside>
      <main className="flex-1 px-6 py-6">{children}</main>
    </div>
  );
}
