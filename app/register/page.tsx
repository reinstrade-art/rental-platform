import { registerWithInvite } from "@/app/lib/actions";

export default function RegisterPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="text-xl font-semibold">Register</h1>
      <p className="mt-1 text-sm text-gray-600">
        Enter the invitation code your office gave you, along with the email or phone number it was issued to.
      </p>
      <form action={registerWithInvite} className="mt-6 flex flex-col gap-3">
        <input
          name="code"
          required
          placeholder="Invitation code"
          className="rounded border px-3 py-2 font-mono uppercase tracking-widest"
        />
        <input name="identifier" required placeholder="Email or phone" className="rounded border px-3 py-2" />
        <input
          name="password"
          type="password"
          required
          minLength={8}
          placeholder="Choose a password (8+ characters)"
          className="rounded border px-3 py-2"
        />
        <button type="submit" className="rounded bg-black px-3 py-2 text-white">
          Register
        </button>
      </form>
    </main>
  );
}
