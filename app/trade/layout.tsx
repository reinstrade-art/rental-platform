import { redirect } from "next/navigation";
import { getSession, requireTradesman } from "@/app/lib/auth";
import { logout } from "@/app/lib/actions";

export default async function TradeLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!requireTradesman(s)) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between bg-ink px-6 py-3 text-lily">
        <div className="font-semibold tracking-tight">My Jobs</div>
        <form action={logout}>
          <button className="text-sm text-silver underline hover:text-lily">Sign out</button>
        </form>
      </header>
      <main className="px-6 py-6">{children}</main>
    </div>
  );
}
