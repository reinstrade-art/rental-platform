import { redirect } from "next/navigation";
import { needsPlatformSetup } from "@/app/lib/auth";
import { platformSetup } from "@/app/lib/actions";

export default async function SetupPage() {
  if (!(await needsPlatformSetup())) redirect("/login");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-ink-photo px-4">
      <img src="/logo.svg" alt="Reins Realty" className="w-48" />
      <div className="w-full max-w-sm rounded-lg border border-ink-soft border-t-2 border-t-gold bg-lily p-8 shadow-xl">
        <h1 className="text-xl font-semibold text-ink">Set up the Platform</h1>
        <p className="mt-1 text-sm text-silver-dark">
          Nobody has signed up yet. This first account becomes the Platform Administrator —
          it provisions landlord organizations, it does not manage properties itself.
        </p>
        <form action={platformSetup} className="mt-6 flex flex-col gap-3">
          <input
            name="email"
            type="email"
            required
            placeholder="Email"
            className="rounded border px-3 py-2"
          />
          <input
            name="password"
            type="password"
            required
            minLength={8}
            placeholder="Password (8+ characters)"
            className="rounded border px-3 py-2"
          />
          <button type="submit" className="rounded bg-ink px-3 py-2 text-lily transition-colors hover:bg-ink-soft">
            Create Platform Administrator
          </button>
        </form>
      </div>
    </main>
  );
}
