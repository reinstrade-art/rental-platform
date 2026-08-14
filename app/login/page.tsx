import { login } from "@/app/lib/actions";

export default async function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-ink px-4">
      <img src="/logo.svg" alt="Reins Estate Management Realty" className="w-48" />
      <div className="w-full max-w-sm rounded-lg border border-ink-soft border-t-2 border-t-gold bg-lily p-8 shadow-xl">
        <h1 className="text-xl font-semibold text-ink">Sign in</h1>
        <form action={login} className="mt-6 flex flex-col gap-3">
          <input
            name="identifier"
            type="text"
            required
            placeholder="Email or phone"
            className="rounded border px-3 py-2"
          />
          <input
            name="password"
            type="password"
            required
            placeholder="Password"
            className="rounded border px-3 py-2"
          />
          <button type="submit" className="rounded bg-ink px-3 py-2 text-lily transition-colors hover:bg-ink-soft">
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
