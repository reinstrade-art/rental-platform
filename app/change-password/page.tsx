import { redirect } from "next/navigation";
import { getSession } from "@/app/lib/auth";
import { changeOwnPassword } from "@/app/lib/actions";

/**
 * Where mustChangePassword sends someone — outside the (app) layout (like
 * /login) so it renders for every role a temporary password could apply to,
 * not just staff. Anyone signed in can reach it, but it only actually does
 * anything once the current password is proven, same as changeOwnPassword
 * itself checks server-side.
 */
export default async function ChangePasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-ink-photo px-4">
      <img src="/logo.svg" alt="Reins Realty" className="w-48" />
      <div className="w-full max-w-sm rounded-lg border border-ink-soft border-t-2 border-t-gold bg-lily p-8 shadow-xl">
        <h1 className="text-xl font-semibold text-ink">Set a new password</h1>
        <p className="mt-1 text-sm text-silver-dark">
          {s.mustChangePassword
            ? "You're signing in with a temporary password. Choose your own before continuing."
            : "Enter your current password and choose a new one."}
        </p>
        {error && (
          <div className="mt-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        <form action={changeOwnPassword} className="mt-6 flex flex-col gap-3">
          <input
            name="currentPassword"
            type="password"
            required
            placeholder="Current (temporary) password"
            className="rounded border px-3 py-2"
          />
          <input
            name="newPassword"
            type="password"
            required
            minLength={8}
            placeholder="New password (8+ characters)"
            className="rounded border px-3 py-2"
          />
          <input
            name="confirmPassword"
            type="password"
            required
            minLength={8}
            placeholder="Confirm new password"
            className="rounded border px-3 py-2"
          />
          <button type="submit" className="rounded bg-ink px-3 py-2 text-lily transition-colors hover:bg-ink-soft">
            Set password
          </button>
        </form>
      </div>
    </main>
  );
}
