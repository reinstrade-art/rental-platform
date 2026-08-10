import { login } from "@/app/lib/actions";

export default async function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="text-xl font-semibold">Sign in</h1>
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
        <button type="submit" className="rounded bg-black px-3 py-2 text-white">
          Sign in
        </button>
      </form>
    </main>
  );
}
