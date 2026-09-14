import { redirect } from "next/navigation";
import { getSession, requireTenant } from "@/app/lib/auth";
import { logout, endImpersonationAction } from "@/app/lib/actions";
import { PushRegistration } from "@/app/components/push-registration";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!requireTenant(s)) redirect("/login");

  return (
    <div className="min-h-screen">
      <PushRegistration />
      <header className="bg-ink-photo text-cream">
        <div className="h-1 bg-metal" />
        <div className="flex items-center justify-between px-6 py-3">
          <div className="border-l-2 border-gold pl-2 font-semibold tracking-tight">My Tenancy</div>
          <form action={logout}>
            <button className="text-sm text-silver-dark underline hover:text-gold">Sign out</button>
          </form>
        </div>
      </header>
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
  );
}
