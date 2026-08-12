import { registerWithInvite } from "@/app/lib/actions";
import { ConsentNotice } from "@/app/components/consent-notice";

const PREVIEW_ORG = {
  name: "the office",
  letterheadName: null,
  letterheadAddress: null,
  letterheadPhone: null,
  letterheadEmail: null,
};

export default function RegisterPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
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

        <ConsentNotice org={PREVIEW_ORG} />
        <label className="flex items-start gap-2 text-xs text-gray-700">
          <input name="consent" type="checkbox" required className="mt-0.5" />
          <span>
            I have read the notice above and agree to my personal information being collected and used for the
            purposes described in it.
          </span>
        </label>

        <button type="submit" className="rounded bg-black px-3 py-2 text-white">
          Register
        </button>
      </form>
    </main>
  );
}
