import { redirect } from "next/navigation";
import { getSession, requireTenant } from "@/app/lib/auth";
import { logout } from "@/app/lib/actions";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!requireTenant(s)) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="bg-ink-photo text-lily">
        <div className="h-1 bg-metal" />
        <div className="flex items-center justify-between px-6 py-3">
          <div className="border-l-2 border-gold pl-2 font-semibold tracking-tight">My Tenancy</div>
          <form action={logout}>
            <button className="text-sm text-silver underline hover:text-gold">Sign out</button>
          </form>
        </div>
      </header>
      <main className="px-6 py-6">{children}</main>
    </div>
  );
}
