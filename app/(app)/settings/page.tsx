import { redirect } from "next/navigation";
import { getSession, requireStaff, deviceLabel } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { getOwnOtherSessions } from "@/app/lib/data";
import {
  updateBranding,
  updateLeaseTerms,
  updateMpesaSettings,
  revokeSessionAction,
  revokeOtherSessionsAction,
} from "@/app/lib/actions";
import { mpesaConfigured } from "@/app/lib/mpesa";

export default async function SettingsPage() {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");

  const org = await prisma.organization.findUniqueOrThrow({ where: { id: s.organizationId } });
  const sessions = await getOwnOtherSessions(s.userId);

  return (
    <div className="flex flex-col gap-10">
    <div className="max-w-sm">
      <h1 className="text-lg font-semibold">Document branding</h1>
      <p className="mt-1 text-sm text-silver-dark">
        Shown on the letterhead of receipts and invoices sent to tenants and tradesmen. Falls back to your
        organization name if left blank.
      </p>
      <form action={updateBranding} className="mt-4 flex flex-col gap-3">
        <input
          name="letterheadName"
          defaultValue={org.letterheadName ?? ""}
          placeholder={org.name}
          className="rounded border px-3 py-2"
        />
        <input
          name="letterheadAddress"
          defaultValue={org.letterheadAddress ?? ""}
          placeholder="Address"
          className="rounded border px-3 py-2"
        />
        <input
          name="letterheadPhone"
          defaultValue={org.letterheadPhone ?? ""}
          placeholder="Phone"
          className="rounded border px-3 py-2"
        />
        <input
          name="letterheadEmail"
          defaultValue={org.letterheadEmail ?? ""}
          placeholder="Email"
          className="rounded border px-3 py-2"
        />

        <label className="mt-2 flex items-center gap-3 text-sm">
          <span className="text-silver-dark">Brand color</span>
          <input
            type="color"
            name="brandColor"
            defaultValue={org.brandColor ?? "#1E3350"}
            className="h-9 w-14 cursor-pointer rounded border"
          />
        </label>
        <p className="text-xs text-silver-dark">
          Used for the band/rail color on receipts and invoices — every organization gets its own look from the
          same template, not a shared default.
        </p>

        <button type="submit" className="rounded bg-ink px-3 py-2 text-lily transition-colors hover:bg-ink-soft">
          Save
        </button>
      </form>
    </div>

    <div className="max-w-lg">
      <h2 className="text-lg font-semibold">Lease terms</h2>
      <p className="mt-1 text-sm text-silver-dark">
        Printed verbatim into every tenancy agreement PDF. This is your own legal text — tenancy terms vary by
        jurisdiction and by landlord, so nothing here is drafted for you. Have it reviewed before use.
      </p>
      <form action={updateLeaseTerms} className="mt-4 flex flex-col gap-3">
        <textarea
          name="leaseTermsTemplate"
          defaultValue={org.leaseTermsTemplate ?? ""}
          rows={10}
          placeholder="Enter your tenancy terms here..."
          className="rounded border px-3 py-2 font-mono text-xs"
        />
        <button type="submit" className="rounded bg-ink px-3 py-2 text-lily transition-colors hover:bg-ink-soft">
          Save
        </button>
      </form>
    </div>

    {s.role === "ADMIN" && (
    <div className="max-w-sm">
      <h2 className="text-lg font-semibold">M-Pesa (STK Push)</h2>
      <p className="mt-1 text-sm text-silver-dark">
        Uses this organization&apos;s own Safaricom shortcode — there is no shared/platform paybill. Get these from your
        Daraja app at developer.safaricom.co.ke.
        {mpesaConfigured({
          env: org.mpesaEnv,
          shortcode: org.mpesaShortcode,
          consumerKey: org.mpesaConsumerKey,
          consumerSecret: org.mpesaConsumerSecret,
          passkey: org.mpesaPasskey,
        }) && <span className="ml-1 font-medium text-green-700">Configured.</span>}
      </p>
      <form action={updateMpesaSettings} className="mt-4 flex flex-col gap-3">
        <select name="mpesaEnv" defaultValue={org.mpesaEnv ?? "sandbox"} className="rounded border px-3 py-2">
          <option value="sandbox">Sandbox (testing)</option>
          <option value="production">Production</option>
        </select>
        <input
          name="mpesaShortcode"
          defaultValue={org.mpesaShortcode ?? ""}
          placeholder="Shortcode (paybill/till)"
          className="rounded border px-3 py-2"
        />
        <input
          name="mpesaConsumerKey"
          defaultValue={org.mpesaConsumerKey ?? ""}
          placeholder="Consumer key"
          className="rounded border px-3 py-2"
        />
        <input
          name="mpesaConsumerSecret"
          type="password"
          defaultValue={org.mpesaConsumerSecret ?? ""}
          placeholder="Consumer secret"
          className="rounded border px-3 py-2"
        />
        <input
          name="mpesaPasskey"
          type="password"
          defaultValue={org.mpesaPasskey ?? ""}
          placeholder="Passkey"
          className="rounded border px-3 py-2"
        />
        <button type="submit" className="rounded bg-ink px-3 py-2 text-lily transition-colors hover:bg-ink-soft">
          Save
        </button>
      </form>
    </div>
    )}

    <div className="max-w-md">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Other devices signed in</h2>
        {sessions.length > 0 && (
          <form action={revokeOtherSessionsAction}>
            <button className="text-xs text-red-700 underline">Sign out of all of them</button>
          </form>
        )}
      </div>
      {sessions.length === 0 ? (
        <p className="mt-2 text-xs text-silver-dark">Nothing else — this is the only place you&apos;re signed in.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {sessions.map((sess) => (
            <li key={sess.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <div>
                <div>{deviceLabel(sess.userAgent)}</div>
                <div className="text-xs text-silver-dark">
                  Signed in {new Date(sess.createdAt).toLocaleDateString()} · last active{" "}
                  {new Date(sess.lastSeenAt).toLocaleDateString()}
                  {sess.ip ? ` · ${sess.ip}` : ""}
                </div>
              </div>
              <form action={revokeSessionAction}>
                <input type="hidden" name="sessionId" value={sess.id} />
                <button className="text-xs text-red-700 underline">Sign out</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
    </div>
  );
}
