import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireStaff, deviceLabel } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { getOwnOtherSessions } from "@/app/lib/data";
import {
  updateBranding,
  updateLeaseTerms,
  updateMpesaSettings,
  updatePayoutMpesaNumber,
  revokeSessionAction,
  revokeOtherSessionsAction,
  createApiKeyAction,
  revokeApiKeyAction,
  createWebhookAction,
  revokeWebhookAction,
  disconnectQuickbooksAction,
  setQuickbooksAccountsAction,
  syncQuickbooksNowAction,
  registerMpesaC2bAction,
} from "@/app/lib/actions";
import { mpesaConfigured } from "@/app/lib/mpesa";
import { quickbooksAppConfigured } from "@/app/lib/quickbooks";
import { mpesaWebhookKey } from "@/app/lib/webhook-secret";
import { listApiKeys } from "@/app/lib/api-keys";
import { listWebhooks } from "@/app/lib/webhooks";
import { CreateApiKeyForm } from "@/app/components/create-api-key-form";
import { CreateWebhookForm } from "@/app/components/create-webhook-form";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; qbConnected?: string; qbSynced?: string; c2bRegistered?: string }>;
}) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  const { error, qbConnected, qbSynced, c2bRegistered } = await searchParams;

  const org = await prisma.organization.findUniqueOrThrow({ where: { id: s.organizationId } });
  const sessions = await getOwnOtherSessions(s.userId);
  const apiKeys = s.role === "ADMIN" ? await listApiKeys(s.organizationId) : [];
  const webhooks = s.role === "ADMIN" ? await listWebhooks(s.organizationId) : [];
  const qbConnection =
    s.role === "ADMIN"
      ? await prisma.accountingConnection.findUnique({
          where: { organizationId_provider: { organizationId: s.organizationId, provider: "QUICKBOOKS" } },
        })
      : null;

  return (
    <div className="flex flex-col gap-10">
    {error && <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    {qbConnected && <div className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700">QuickBooks settings saved.</div>}
    {qbSynced && <div className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700">Synced {qbSynced} payment(s) to QuickBooks.</div>}
    {c2bRegistered && <div className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700">Registered with Safaricom — payments to your paybill will now auto-match by unit payment code.</div>}
    <div className="max-w-sm rounded border p-4">
      <h2 className="font-semibold">Plan</h2>
      <p className="mt-1 text-sm text-silver-dark">
        You&apos;re on <strong>{org.tier}</strong>. Upgrade or downgrade your package.
      </p>
      <Link href="/settings/plan" className="mt-3 inline-block rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
        Manage plan
      </Link>
    </div>

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
        Printed into every tenancy agreement PDF. This is your own legal text — tenancy terms vary by jurisdiction
        and by landlord, so nothing here is drafted for you. Have it reviewed before use.
      </p>
      <p className="mt-2 text-xs text-silver-dark">
        Any blank you&apos;d normally fill in by hand (e.g. &quot;PROPERTY:………&quot;) can be replaced with a token that
        auto-fills from the actual lease: <code className="font-mono">{"{{tenant}}"}</code>,{" "}
        <code className="font-mono">{"{{phone}}"}</code>, <code className="font-mono">{"{{email}}"}</code>,{" "}
        <code className="font-mono">{"{{property}}"}</code>, <code className="font-mono">{"{{unit}}"}</code>,{" "}
        <code className="font-mono">{"{{rent}}"}</code>, <code className="font-mono">{"{{deposit}}"}</code>,{" "}
        <code className="font-mono">{"{{startdate}}"}</code>, <code className="font-mono">{"{{landlord}}"}</code>.
        E.g. write &quot;UNIT NO: {"{{unit}}"}&quot; instead of leaving a dotted line.
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
          accountType: org.mpesaAccountType,
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
        <select name="mpesaAccountType" defaultValue={org.mpesaAccountType ?? "PAYBILL"} className="rounded border px-3 py-2">
          <option value="PAYBILL">Paybill number</option>
          <option value="TILL">Till number (Buy Goods and Services)</option>
        </select>
        <input
          name="mpesaShortcode"
          defaultValue={org.mpesaShortcode ?? ""}
          placeholder="Shortcode (your paybill or till number)"
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

    {s.role === "ADMIN" && (
    <div className="max-w-lg">
      <h2 className="text-lg font-semibold">M-Pesa paybill auto-matching (C2B)</h2>
      <p className="mt-1 text-sm text-silver-dark">
        For tenants who pay your paybill directly (rather than through an app prompt) — give each unit a Payment
        code on its Properties page (e.g. A1, B2), tell tenants to enter it as the M-Pesa Account Number when they
        pay, and a matching payment is recorded against that unit&apos;s active lease automatically.
      </p>
      {mpesaConfigured({
        env: org.mpesaEnv,
        shortcode: org.mpesaShortcode,
        accountType: org.mpesaAccountType,
        consumerKey: org.mpesaConsumerKey,
        consumerSecret: org.mpesaConsumerSecret,
        passkey: org.mpesaPasskey,
      }) ? (
        <>
          <p className="mt-3 text-xs text-silver-dark">
            Your webhook URL (Safaricom needs this registered as this paybill&apos;s Confirmation/Validation URL —
            the button below does that for you):
          </p>
          <code className="mt-1 block break-all rounded border bg-silver-light px-2 py-1.5 font-mono text-xs text-ink">
            {process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/webhooks/mpesa/{s.organizationId}/{mpesaWebhookKey(s.organizationId)}
          </code>
          <form action={registerMpesaC2bAction} className="mt-2">
            <button className="rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
              Register with Safaricom
            </button>
          </form>
        </>
      ) : (
        <p className="mt-2 text-xs text-silver-dark">Set up M-Pesa (STK Push) above first — C2B uses the same paybill and credentials.</p>
      )}
    </div>
    )}

    {s.role === "ADMIN" && (
    <div className="max-w-sm">
      <h2 className="text-lg font-semibold">Payout number</h2>
      <p className="mt-1 text-sm text-silver-dark">
        {org.commissionRouted
          ? "The platform is sharing tenant rent revenue with you — this is the M-Pesa number your share is sent to after each payment."
          : "Where the platform sends your share of tenant rent revenue, if and once it enrolls this account in commission routing. Harmless to set now — unused until then."}
      </p>
      <form action={updatePayoutMpesaNumber} className="mt-3 flex flex-col gap-3">
        <input
          name="payoutMpesaNumber"
          defaultValue={org.payoutMpesaNumber ?? ""}
          placeholder="M-Pesa number (07... or 254...)"
          className="rounded border px-3 py-2"
        />
        <button type="submit" className="rounded bg-ink px-3 py-2 text-lily transition-colors hover:bg-ink-soft">
          Save
        </button>
      </form>
    </div>
    )}

    {s.role === "ADMIN" && (
    <div className="max-w-md">
      <h2 className="text-lg font-semibold">API keys</h2>
      <p className="mt-1 text-sm text-silver-dark">
        For an accountant or ERP system to pull this org&apos;s tenants, leases, payments, and charges directly — see{" "}
        <code className="font-mono text-xs">/api/v1</code>. Each key can only read this organization&apos;s own data.
      </p>
      {apiKeys.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {apiKeys.map((k) => (
            <li key={k.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <span>
                {k.name} <span className="font-mono text-xs text-silver-dark">{k.keyPrefix}…</span>
                {k.revokedAt && <span className="ml-2 text-xs text-silver-dark">Revoked</span>}
                {!k.revokedAt && k.lastUsedAt && (
                  <span className="ml-2 text-xs text-silver-dark">Last used {new Date(k.lastUsedAt).toLocaleDateString()}</span>
                )}
                {!k.revokedAt && !k.lastUsedAt && <span className="ml-2 text-xs text-silver-dark">Never used</span>}
              </span>
              {!k.revokedAt && (
                <form action={revokeApiKeyAction.bind(null, k.id)}>
                  <button className="text-xs text-red-700 underline">Revoke</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3">
        <CreateApiKeyForm action={createApiKeyAction} />
      </div>
    </div>
    )}

    {s.role === "ADMIN" && (
    <div className="max-w-md">
      <h2 className="text-lg font-semibold">Webhooks</h2>
      <p className="mt-1 text-sm text-silver-dark">
        Push events (a payment recorded, a charge added, a lease signed) to your own URL the moment they happen —
        for Zapier, your ERP&apos;s webhook receiver, or a custom integration. No retry queue: a delivery that fails
        is not retried, so check back here if an endpoint stops working.
      </p>
      {webhooks.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {webhooks.map((w) => (
            <li key={w.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <span className="truncate">
                {w.url}
                {w.disabledAt && <span className="ml-2 text-xs text-silver-dark">Revoked</span>}
                {!w.disabledAt && w.lastTriggeredAt && (
                  <span className="ml-2 text-xs text-silver-dark">
                    Last delivery {new Date(w.lastTriggeredAt).toLocaleDateString()} · {w.lastStatus ?? "no response"}
                  </span>
                )}
                {!w.disabledAt && !w.lastTriggeredAt && <span className="ml-2 text-xs text-silver-dark">Never triggered</span>}
              </span>
              {!w.disabledAt && (
                <form action={revokeWebhookAction.bind(null, w.id)}>
                  <button className="text-xs text-red-700 underline">Revoke</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3">
        <CreateWebhookForm action={createWebhookAction} />
      </div>
    </div>
    )}

    {s.role === "ADMIN" && (
    <div className="max-w-sm">
      <h2 className="text-lg font-semibold">QuickBooks</h2>
      {!quickbooksAppConfigured() ? (
        <p className="mt-1 text-sm text-silver-dark">Not available on this platform yet.</p>
      ) : qbConnection ? (
        <>
          <p className="mt-1 text-sm text-silver-dark">
            Connected — every rent payment posts automatically as a journal entry once both account IDs below are
            set. Find an account&apos;s ID in QuickBooks under Accounting → Chart of Accounts.
          </p>
          <form action={setQuickbooksAccountsAction} className="mt-3 flex flex-col gap-3">
            <input
              name="incomeAccountId"
              defaultValue={qbConnection.incomeAccountId ?? ""}
              placeholder="Rental income account ID"
              className="rounded border px-3 py-2 text-sm"
            />
            <input
              name="bankAccountId"
              defaultValue={qbConnection.bankAccountId ?? ""}
              placeholder="Bank / Undeposited Funds account ID"
              className="rounded border px-3 py-2 text-sm"
            />
            <button className="rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">Save account IDs</button>
          </form>
          <div className="mt-3 flex items-center gap-3">
            <form action={syncQuickbooksNowAction}>
              <button className="rounded border px-3 py-1.5 text-xs transition-colors hover:bg-silver-light">Sync now</button>
            </form>
            <form action={disconnectQuickbooksAction}>
              <button className="text-xs text-red-700 underline">Disconnect</button>
            </form>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-silver-dark">Not connected — payments won&apos;t post to your books until you connect.</p>
          <a
            href="/api/accounting/quickbooks/connect"
            className="mt-3 inline-block rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft"
          >
            Connect QuickBooks
          </a>
        </>
      )}
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
