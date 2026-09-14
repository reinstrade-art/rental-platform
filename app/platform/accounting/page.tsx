import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requirePlatformAdmin } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { waveAppConfigured, currentWaveBusiness } from "@/app/lib/wave";
import { disconnectWaveAction, setWaveAccountsAction, syncWaveNowAction } from "@/app/lib/actions";

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default async function PlatformAccountingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; waveConnected?: string; waveSynced?: string }>;
}) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!requirePlatformAdmin(s)) redirect("/home");

  const { error, waveConnected, waveSynced } = await searchParams;
  const connection = await prisma.platformAccountingConnection.findUnique({ where: { id: "default" } });

  let business: Awaited<ReturnType<typeof currentWaveBusiness>> | null = null;
  let businessError: string | null = null;
  if (connection) {
    try {
      business = await currentWaveBusiness();
    } catch (e) {
      businessError = e instanceof Error ? e.message : "Could not reach Wave.";
    }
  }

  const syncLogs = connection
    ? await prisma.platformAccountingSyncLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 25,
        include: {
          licensePayment: { select: { amount: true, organization: { select: { name: true } } } },
          payout: { select: { netAmount: true, organization: { select: { name: true } } } },
        },
      })
    : [];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Accounting</h1>
          <p className="mt-1 text-sm text-silver-dark">
            The platform&apos;s own books — license revenue and commission payouts synced to Wave. Separate from an
            organization&apos;s own accounting connection (their tenants&apos; books, in each org&apos;s own Settings).
          </p>
        </div>
        <Link href="/platform" className="text-xs underline text-silver-dark">
          Back to organizations
        </Link>
      </div>

      {error && <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {waveConnected && (
        <div className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700">Wave connection saved.</div>
      )}
      {waveSynced !== undefined && (
        <div className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700">
          Synced {waveSynced} transaction(s) to Wave.
        </div>
      )}

      {!waveAppConfigured() ? (
        <div className="max-w-lg rounded border p-4 text-sm text-silver-dark">
          Wave isn&apos;t configured on this deployment yet. Register an app at{" "}
          <a href="https://developer.waveapps.com" target="_blank" className="underline">
            developer.waveapps.com
          </a>{" "}
          and set <code className="rounded bg-silver-light px-1 py-0.5 font-mono text-xs">WAVE_CLIENT_ID</code> /{" "}
          <code className="rounded bg-silver-light px-1 py-0.5 font-mono text-xs">WAVE_CLIENT_SECRET</code> as environment
          variables (its OAuth redirect URI is{" "}
          <code className="break-all rounded bg-silver-light px-1 py-0.5 font-mono text-xs">
            {process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/platform/wave/callback
          </code>
          ).
        </div>
      ) : !connection ? (
        <div className="max-w-sm rounded border p-4">
          <h2 className="font-semibold">Connect Wave</h2>
          <p className="mt-1 text-sm text-silver-dark">
            Signs in with a Wave account and picks up its first business. License payments post as income; commission
            payouts post as an expense — both against accounts you choose below once connected.
          </p>
          <a
            href="/api/platform/wave/connect"
            className="mt-3 inline-block rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft"
          >
            Connect Wave
          </a>
        </div>
      ) : (
        <>
          <div className="max-w-sm rounded border p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Connected</h2>
              <form action={disconnectWaveAction}>
                <button className="text-xs text-red-600 underline">Disconnect</button>
              </form>
            </div>
            {businessError ? (
              <p className="mt-2 text-sm text-red-700">{businessError}</p>
            ) : (
              <p className="mt-2 text-sm text-silver-dark">
                Business: <span className="font-medium text-ink">{business?.name}</span>
              </p>
            )}

            {business && (
              <form action={setWaveAccountsAction} className="mt-4 flex flex-col gap-3">
                <label className="text-xs text-silver-dark">
                  Income account (credited by license payments)
                  <select
                    name="incomeAccountId"
                    defaultValue={connection.incomeAccountId ?? ""}
                    className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  >
                    <option value="">— choose —</option>
                    {business.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.type})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-silver-dark">
                  Expense account (debited by commission payouts)
                  <select
                    name="expenseAccountId"
                    defaultValue={connection.expenseAccountId ?? ""}
                    className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  >
                    <option value="">— choose —</option>
                    {business.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.type})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-silver-dark">
                  Bank account (the anchor both sides move through)
                  <select
                    name="bankAccountId"
                    defaultValue={connection.bankAccountId ?? ""}
                    className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  >
                    <option value="">— choose —</option>
                    {business.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.type})
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
                  Save accounts
                </button>
              </form>
            )}
          </div>

          <div className="max-w-3xl">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Sync log</h2>
              <form action={syncWaveNowAction}>
                <button className="rounded border px-3 py-2 text-sm transition-colors hover:bg-silver-light">Sync now</button>
              </form>
            </div>
            <p className="mt-1 text-sm text-silver-dark">
              Every license payment and completed payout posts to Wave automatically; this catches up anything that
              didn&apos;t, and shows what went wrong when it didn&apos;t.
            </p>
            <table className="mt-3 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
                  <th className="px-2 py-2">Kind</th>
                  <th className="px-2 py-2">Organization</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {syncLogs.map((log) => {
                  const org = log.licensePayment?.organization.name ?? log.payout?.organization.name ?? "—";
                  const amount = log.licensePayment?.amount ?? log.payout?.netAmount ?? 0;
                  return (
                    <tr key={log.id} className="border-b border-silver">
                      <td className="px-2 py-2">{log.kind === "LICENSE_PAYMENT" ? "License" : "Payout"}</td>
                      <td className="px-2 py-2">{org}</td>
                      <td className="px-2 py-2 text-right">{money(amount)}</td>
                      <td
                        className={`px-2 py-2 ${
                          log.status === "SUCCESS" ? "text-green-700" : log.status === "FAILED" ? "text-red-600" : "text-silver-dark"
                        }`}
                      >
                        {log.status}
                      </td>
                      <td className="px-2 py-2 text-xs text-silver-dark">{log.error ?? log.externalId ?? ""}</td>
                    </tr>
                  );
                })}
                {syncLogs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-2 py-4 text-center text-silver-dark">
                      Nothing synced yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
