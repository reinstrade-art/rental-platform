import { redirect } from "next/navigation";
import { getSession, requireTenant } from "@/app/lib/auth";
import { logout } from "@/app/lib/actions";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!requireTenant(s)) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="font-semibold">My Tenancy</div>
        <form action={logout}>
          <button className="text-sm text-gray-600 underline">Sign out</button>
        </form>
      </header>
      <main className="px-6 py-6">{children}</main>
    </div>
  );
}
