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
    <main className="flex min-h-screen justify-center bg-ink px-4 py-10">
      <div className="h-fit w-full max-w-sm rounded-lg border border-ink-soft border-t-2 border-t-gold bg-lily p-8 shadow-xl">
        <h1 className="text-xl font-semibold text-ink">Register</h1>
        <p className="mt-1 text-sm text-silver-dark">
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
          <label className="flex items-start gap-2 text-xs text-silver-dark">
            <input name="consent" type="checkbox" required className="mt-0.5" />
            <span>
              I have read the notice above and agree to my personal information being collected and used for the
              purposes described in it.
            </span>
          </label>

          <button type="submit" className="rounded bg-ink px-3 py-2 text-lily transition-colors hover:bg-ink-soft">
            Register
          </button>
        </form>
      </div>
    </main>
  );
}
