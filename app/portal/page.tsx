import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireTenant } from "@/app/lib/auth";
import { getTenantPortal, leaseBalance } from "@/app/lib/data";
import { payMpesaSelf } from "@/app/lib/mpesa-actions";
import { mpesaPayOptionsForLease } from "@/app/lib/mpesa-pay-options";
import { MpesaPayPanel } from "@/app/components/mpesa-pay-panel";
import { signLease, sendTenantMessage, requestRepair } from "@/app/lib/actions";
import { SignaturePad } from "@/app/components/signature-pad";
import { RichTextEditor } from "@/app/components/rich-text-editor";
import { displayBalance, balanceTone } from "@/app/lib/balance-display";
import { getOrgTier, hasFeature } from "@/app/lib/tier";
import { REPAIR_PRIORITIES } from "@/app/lib/constants";
import { KIND_LABEL, WARNING_GROUNDS } from "@/app/lib/warnings";

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function periodParam(d: Date) {
  const dt = new Date(d);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function TenantPortalPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const s = await getSession();
  if (!requireTenant(s)) redirect("/login");
  const { error } = await searchParams;

  const tenant = await getTenantPortal(s.tenantId);
  const repairsEnabled = hasFeature(await getOrgTier(s.organizationId), "REPAIRS");
  const activeLeases = tenant.leases.filter((l) => l.status === "ACTIVE");

  // Both M-Pesa routes for each active tenancy, resolved up front — the JSX
  // map below can't await, and a tenant has only one or two leases anyway.
  const payOptions = new Map(
    await Promise.all(
      activeLeases.map(async (l) => [l.id, await mpesaPayOptionsForLease(s.organizationId, l.id)] as const),
    ),
  );

  return (
    <div className="flex flex-col gap-8">
      {error && <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <h1 className="text-lg font-semibold">Hello, {tenant.name}</h1>

      {(() => {
        // Formal letters the office has sent about this tenancy. Opening one
        // here is recorded as read — the tenant's own proof, and the office's.
        const notices = tenant.leases.flatMap((l) => l.tenantWarnings);
        if (notices.length === 0) return null;
        return (
          <div className="rounded border border-orange-300 bg-orange-50 p-4">
            <h2 className="text-sm font-semibold text-orange-800">Notices about your tenancy</h2>
            <ul className="mt-2 flex flex-col gap-2">
              {notices.map((n) => (
                <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    <span className="font-medium">{KIND_LABEL[n.kind] ?? n.kind}</span>
                    <span className="ml-1 text-xs text-silver-dark">
                      {n.grounds
                        .split(",")
                        .map((g) => WARNING_GROUNDS[g as keyof typeof WARNING_GROUNDS]?.title ?? g)
                        .join("; ")}{" "}
                      · sent {new Date(n.createdAt).toLocaleDateString()} · act by {new Date(n.complyBy).toLocaleDateString()}
                    </span>
                  </span>
                  <Link href={`/api/warning/${n.id}`} target="_blank" className="text-xs underline">
                    Read the letter
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}

      {tenant.leases.map((lease) => {
        const balance = leaseBalance(lease);
        const periods = [...new Set(lease.charges.map((c) => periodParam(c.periodMonth)))];
        return (
          <div key={lease.id} className="rounded border p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">
                  {lease.unit.property.name} / {lease.unit.label}
                </div>
                <div className="text-xs text-silver-dark">
                  {money(lease.monthlyRent)}/month · {lease.status}
                </div>
                <div className="flex gap-3">
                  <Link href={`/api/statement/${lease.id}`} target="_blank" className="text-xs underline text-silver-dark">
                    Full statement
                  </Link>
                  <Link href={`/api/agreement/${lease.id}`} target="_blank" className="text-xs underline text-silver-dark">
                    Tenancy agreement
                  </Link>
                </div>
              </div>
              <div className={`text-right ${balanceTone(balance)}`}>
                <div className="text-xs text-silver-dark">Balance</div>
                <div className="text-lg font-semibold">{money(displayBalance(balance))}</div>
              </div>
            </div>

            <div className="mt-4 grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold">Charges</h3>
                <table className="mt-1 w-full text-sm">
                  <tbody>
                    {lease.charges.map((c) => (
                      <tr key={c.id} className="border-b">
                        <td className="py-1">
                          {new Date(c.periodMonth).toLocaleDateString(undefined, { year: "numeric", month: "short" })}
                        </td>
                        <td className="py-1">{c.type}</td>
                        <td className="py-1 text-right">{money(c.amount)}</td>
                      </tr>
                    ))}
                    {lease.charges.length === 0 && (
                      <tr>
                        <td className="py-1 text-silver-dark">No charges yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <div className="mt-2 flex flex-wrap gap-2">
                  {periods.map((p) => (
                    <Link
                      key={p}
                      href={`/api/invoice/${lease.id}?period=${p}`}
                      target="_blank"
                      className="text-xs underline text-silver-dark"
                    >
                      Invoice {p}
                    </Link>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold">Payments</h3>
                <table className="mt-1 w-full text-sm">
                  <tbody>
                    {lease.payments.map((p) => (
                      <tr key={p.id} className="border-b">
                        <td className="py-1">{new Date(p.paidAt).toLocaleDateString()}</td>
                        <td className="py-1">{p.method ?? "—"}</td>
                        <td className="py-1 text-right">{money(p.amount)}</td>
                        <td className="py-1 text-right">
                          <Link href={`/api/receipt/${p.id}`} target="_blank" className="text-xs underline text-silver-dark">
                            Receipt
                          </Link>
                        </td>
                      </tr>
                    ))}
                    {lease.payments.length === 0 && (
                      <tr>
                        <td className="py-1 text-silver-dark">No payments yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {(() => {
              const opts = payOptions.get(lease.id);
              if (!opts || (!opts.stkReady && !opts.directReady)) return null;
              return (
                <div className="mt-4 max-w-sm border-t pt-4">
                  <h3 className="text-sm font-semibold">Pay via M-Pesa</h3>
                  <div className="mt-2">
                    <MpesaPayPanel
                      action={payMpesaSelf}
                      defaultAmount={balance > 0 ? balance : lease.monthlyRent}
                      phone={tenant.phone}
                      buttonLabel="Pay now"
                      stkReady={opts.stkReady}
                      direct={{
                        ready: opts.directReady,
                        accountType: opts.accountType,
                        shortcode: opts.shortcode,
                        accountRef: opts.accountRef,
                        autoMatch: opts.directAutoMatch,
                      }}
                    />
                  </div>
                </div>
              );
            })()}

            <div className="mt-4 max-w-sm border-t pt-4">
              <h3 className="text-sm font-semibold">Tenancy agreement</h3>
              {lease.signedAt ? (
                <div className="mt-1">
                  <p className="text-xs text-green-700">
                    Signed {new Date(lease.signedAt).toLocaleDateString()} as {lease.signedByName}.
                  </p>
                  <Link href={`/api/agreement/${lease.id}`} target="_blank" className="mt-1 inline-block text-xs underline">
                    Download your signed copy
                  </Link>
                </div>
              ) : (
                <form action={signLease.bind(null, lease.id)} className="mt-2 flex flex-col gap-2">
                  <p className="text-xs text-silver-dark">
                    Read the full{" "}
                    <Link href={`/api/agreement/${lease.id}`} target="_blank" className="underline">
                      tenancy agreement
                    </Link>{" "}
                    before signing.
                  </p>
                  <input
                    name="signedByName"
                    required
                    defaultValue={tenant.name}
                    placeholder="Your full name"
                    className="rounded border px-3 py-2 text-sm"
                  />
                  <SignaturePad name="signatureImage" />
                  <button type="submit" className="rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
                    Sign agreement
                  </button>
                </form>
              )}
            </div>
          </div>
        );
      })}
      {tenant.leases.length === 0 && <p className="text-sm text-silver-dark">No tenancy on file yet.</p>}

      {repairsEnabled && (
        <div className="rounded border p-4">
          <h2 className="text-sm font-semibold">Repairs</h2>
          <p className="text-xs text-silver-dark">Something broken in your unit? Report it here — the office is notified and tracks it through to done.</p>

          <ul className="mt-3 flex flex-col gap-2">
            {tenant.reportedRepairs.map((r) => (
              <li key={r.id} className="rounded border px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{r.title}</span>
                  <span
                    className={`text-xs font-semibold ${
                      r.status === "DONE" ? "text-green-700" : r.status === "CANCELLED" ? "text-silver-dark" : "text-ink"
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
                <p className="text-xs text-silver-dark">
                  {r.property.name}
                  {r.unit ? ` / ${r.unit.label}` : ""} · reported {new Date(r.reportedAt).toLocaleDateString()}
                </p>
              </li>
            ))}
            {tenant.reportedRepairs.length === 0 && <p className="text-xs text-silver-dark">No repair requests yet.</p>}
          </ul>

          {activeLeases.length > 0 ? (
            <form action={requestRepair} className="mt-3 flex flex-col gap-2 border-t pt-3">
              {activeLeases.length > 1 ? (
                <select name="leaseId" required className="rounded border px-3 py-2 text-sm">
                  {activeLeases.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.unit.property.name} / {l.unit.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input type="hidden" name="leaseId" value={activeLeases[0].id} />
              )}
              <input name="title" required placeholder="What's wrong (short title)" className="rounded border px-3 py-2 text-sm" />
              <textarea name="description" rows={2} placeholder="Details (optional)" className="rounded border px-3 py-2 text-sm" />
              <div className="flex gap-2">
                <input name="category" placeholder="Category (e.g. Plumbing)" className="flex-1 rounded border px-3 py-2 text-sm" />
                <select name="priority" defaultValue="NORMAL" className="rounded border px-3 py-2 text-sm">
                  {REPAIR_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="self-start rounded bg-ink px-3 py-1.5 text-sm text-lily transition-colors hover:bg-ink-soft">
                Report a repair
              </button>
            </form>
          ) : (
            <p className="mt-3 text-xs text-silver-dark border-t pt-3">Reporting a repair needs an active tenancy on file.</p>
          )}
        </div>
      )}

      <div className="rounded border p-4">
        <h2 className="text-sm font-semibold">Messages</h2>
        <p className="text-xs text-silver-dark">Write to the office here — they&apos;ll reply in the same thread.</p>

        <ul className="mt-3 flex flex-col gap-2">
          {tenant.messages.slice(-10).map((msg) => (
            <li
              key={msg.id}
              className={`max-w-[85%] rounded border px-3 py-2 text-sm ${msg.fromTenant ? "ml-auto bg-silver-light" : ""}`}
            >
              <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: msg.body }} />
              {msg.attachments.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {msg.attachments.map((a) => (
                    <li key={a.id}>
                      <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" className="text-xs underline">
                        📎 {a.filename} ({Math.round(a.size / 1024)}KB)
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-xs text-silver-dark">
                {msg.fromTenant ? tenant.name : msg.authorName} · {new Date(msg.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
          {tenant.messages.length === 0 && <p className="text-xs text-silver-dark">No messages yet.</p>}
        </ul>

        <form action={sendTenantMessage} encType="multipart/form-data" className="mt-3 flex flex-col gap-2 border-t pt-3">
          <RichTextEditor name="body" placeholder="Write a message…" />
          <input name="attachments" type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" className="text-xs" />
          <button type="submit" className="self-start rounded bg-ink px-3 py-1.5 text-sm text-lily transition-colors hover:bg-ink-soft">
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
