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
  deleteApiKeyAction,
  createWebhookAction,
  revokeWebhookAction,
  disconnectQuickbooksAction,
  setQuickbooksAccountsAction,
  syncQuickbooksNowAction,
  registerMpesaC2bAction,
  generateUnitPaymentCodesAction,
  updateCollectionsSettings,
  runCollectionsNowAction,
  updateWarningSettings,
} from "@/app/lib/actions";
import { mpesaConfigured } from "@/app/lib/mpesa";
import { quickbooksAppConfigured } from "@/app/lib/quickbooks";
import { mpesaWebhookKey } from "@/app/lib/webhook-secret";
import { listApiKeys } from "@/app/lib/api-keys";
import { listWebhooks } from "@/app/lib/webhooks";
import { CreateApiKeyForm } from "@/app/components/create-api-key-form";
import { CreateWebhookForm } from "@/app/components/create-webhook-form";
import { DesktopVersion } from "@/app/components/desktop-version";
import { getRecentCollectionEvents, collectionKindLabel } from "@/app/lib/collections";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; qbConnected?: string; qbSynced?: string; c2bRegistered?: string; codesAssigned?: string; collectionsSaved?: string; collectionsRan?: string; warningSaved?: string }>;
}) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  const { error, qbConnected, qbSynced, c2bRegistered, codesAssigned, collectionsSaved, collectionsRan, warningSaved } = await searchParams;

  const org = await prisma.organization.findUniqueOrThrow({ where: { id: s.organizationId } });
  const sessions = await getOwnOtherSessions(s.userId);
  const collectionEvents = s.role === "ADMIN" ? await getRecentCollectionEvents(s.organizationId) : [];
  const [ranReminders, ranFees, ranUnreachable] = (collectionsRan ?? "").split("-").map(Number);
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
    {warningSaved && <div className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700">Warning policy saved.</div>}
    {collectionsSaved && <div className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700">Reminder and late fee settings saved.</div>}
    {collectionsRan !== undefined && (
      <div className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700">
        Ran today&apos;s steps: {ranReminders} reminder(s) sent, {ranFees} late fee(s) raised
        {ranUnreachable > 0 ? `, ${ranUnreachable} reminder(s) had no channel that could reach the tenant` : ""}.
      </div>
    )}
    {codesAssigned !== undefined && <div className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700">Assigned payment codes to {codesAssigned} unit(s) that had none.</div>}
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

        <input
          name="kraPin"
          defaultValue={org.kraPin ?? ""}
          placeholder="KRA PIN (e.g. A012345678Z) — printed on receipts and invoices"
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
        The other half of the hybrid payment panel — for a tenant who pays your paybill straight from the M-Pesa
        menu instead of tapping the prompt. Each unit needs a Payment code (its M-Pesa Account Number); tenants and
        staff see it on the lease automatically, and a matching payment posts to that unit&apos;s active lease on its
        own. Codes are also editable per unit on the Properties page.
      </p>
      <form action={generateUnitPaymentCodesAction} className="mt-3">
        <button className="rounded border px-3 py-2 text-sm transition-colors hover:bg-silver-light">
          Generate payment codes for all units
        </button>
      </form>
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
    <div className="max-w-xl">
      <h2 className="text-lg font-semibold">Automatic rent reminders &amp; late fees</h2>
      <p className="mt-1 text-sm text-silver-dark">
        Nudges tenants before and after rent is due, and can add a late fee once the grace period passes — the routine
        that gets rent in on time without anyone chasing by hand. Off until you switch it on. Reminders go out by app
        notification and email, and by SMS or WhatsApp once those are set up on the platform.
      </p>
      <form action={updateCollectionsSettings} className="mt-3 flex flex-col gap-3 rounded border p-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="collectionsEnabled" defaultChecked={org.collectionsEnabled} />
          Send reminders and apply late fees automatically
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-silver-dark">
            Rent is due on day
            <input name="rentDueDay" type="number" min={1} max={28} defaultValue={org.rentDueDay} className="mt-1 w-full rounded border px-3 py-2 text-sm text-ink" />
          </label>
          <label className="text-xs text-silver-dark">
            Remind this many days before
            <input name="reminderDaysBefore" type="number" min={0} max={14} defaultValue={org.reminderDaysBefore} className="mt-1 w-full rounded border px-3 py-2 text-sm text-ink" />
          </label>
          <label className="text-xs text-silver-dark">
            Grace days after due date
            <input name="graceDays" type="number" min={0} max={28} defaultValue={org.graceDays} className="mt-1 w-full rounded border px-3 py-2 text-sm text-ink" />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-silver-dark">
            Late fee
            <select name="lateFeeMode" defaultValue={org.lateFeeMode} className="mt-1 w-full rounded border px-3 py-2 text-sm text-ink">
              <option value="NONE">No late fee — reminders only</option>
              <option value="FLAT">Flat amount (KES)</option>
              <option value="PERCENT">Percent of the month&apos;s rent</option>
            </select>
          </label>
          <label className="text-xs text-silver-dark">
            Amount (KES, or % of rent)
            <input name="lateFeeValue" type="number" min={0} step="0.5" defaultValue={org.lateFeeValue} className="mt-1 w-full rounded border px-3 py-2 text-sm text-ink" />
          </label>
        </div>
        <p className="text-xs text-silver-dark">
          A late fee is added once per month, as its own charge, only if that month&apos;s rent is still unpaid after the
          grace days — and never for a month that was already due when you switched this on.
        </p>
        <button type="submit" className="self-start rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
          Save
        </button>
      </form>
      {org.collectionsEnabled && (
        <form action={runCollectionsNowAction} className="mt-2">
          <button className="rounded border px-3 py-2 text-sm transition-colors hover:bg-silver-light">Run today&apos;s steps now</button>
        </form>
      )}
      {collectionEvents.length > 0 && (
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
              <th className="py-2">When</th>
              <th className="py-2">Tenant</th>
              <th className="py-2">Step</th>
              <th className="py-2">Sent via</th>
            </tr>
          </thead>
          <tbody>
            {collectionEvents.map((e) => (
              <tr key={e.id} className="border-b">
                <td className="py-1.5 text-xs text-silver-dark">{new Date(e.createdAt).toLocaleDateString()}</td>
                <td className="py-1.5">
                  {e.lease.tenant.name}
                  <span className="ml-1 text-xs text-silver-dark">{e.lease.unit.property.name} / {e.lease.unit.label}</span>
                </td>
                <td className="py-1.5">
                  {collectionKindLabel(e.kind)}
                  {e.amount ? ` · KES ${Math.round(e.amount).toLocaleString()}` : ""}
                </td>
                <td className={`py-1.5 text-xs ${e.channels ? "" : "text-orange-600"}`}>{e.channels ? e.channels.split(",").join(", ") : "no channel reached them"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
    )}

    {s.role === "ADMIN" && (
    <div className="max-w-xl">
      <h2 className="text-lg font-semibold">Automatic final arrears warning</h2>
      <p className="mt-1 text-sm text-silver-dark">
        On the day of the month you choose (the 11th by default), every tenant who is a full month or more behind on rent
        is sent one formal <strong>first and final warning</strong> — a PDF letter with a payment deadline, delivered by
        email, SMS/WhatsApp and app notification, and recorded with proof of delivery on the Evictions page. A tenant
        already warned in the last six months isn&apos;t warned again; the next step is yours to decide. It never serves a
        Notice to Vacate or starts an eviction by itself. Off until you switch it on.
      </p>
      <form action={updateWarningSettings} className="mt-3 flex flex-col gap-3 rounded border p-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="arrearsWarningAuto" defaultChecked={org.arrearsWarningAuto} />
          Send the final warning automatically
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-silver-dark">
            Send on day of the month
            <input name="arrearsWarningDay" type="number" min={1} max={25} defaultValue={org.arrearsWarningDay} className="mt-1 w-full rounded border px-3 py-2 text-sm text-ink" />
          </label>
          <label className="text-xs text-silver-dark">
            Days the tenant is given to pay
            <input name="warningCureDays" type="number" min={1} max={30} defaultValue={org.warningCureDays} className="mt-1 w-full rounded border px-3 py-2 text-sm text-ink" />
          </label>
        </div>
        <button type="submit" className="self-start rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
          Save
        </button>
      </form>
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
              {/* Only offered once a key is both revoked and was never used -- a used-then-revoked key keeps its
                  lastUsedAt as history instead, see deleteApiKey()'s own comment for why. */}
              {k.revokedAt && !k.lastUsedAt && (
                <form action={deleteApiKeyAction.bind(null, k.id)}>
                  <button className="text-xs text-red-700 underline">Delete</button>
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

    <DesktopVersion />
    </div>
  );
}
