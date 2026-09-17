import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { headers } from "next/headers";
import { getSession, requireStaff, canViewTenantPII } from "@/app/lib/auth";
import { maskTenantName } from "@/app/lib/tenant-privacy";
import { getLease, leaseBalance } from "@/app/lib/data";
import {
  addCharge,
  updateCharge,
  deleteCharge,
  recordPayment,
  updatePayment,
  deletePayment,
  recordDirectedPayment,
  startEviction,
  deleteLease,
  forceDeleteLease,
} from "@/app/lib/actions";
import { allocate } from "@/app/lib/settle";
import { DeleteButton } from "@/app/components/delete-button";
import { sendMpesaPrompt } from "@/app/lib/mpesa-actions";
import { mpesaPayOptionsForLease } from "@/app/lib/mpesa-pay-options";
import { prisma } from "@/app/lib/prisma";
import { CHARGE_TYPES, CHARGE_TYPE_LABEL, PAYMENT_METHODS } from "@/app/lib/constants";
import { MpesaPayPanel } from "@/app/components/mpesa-pay-panel";
import { GROUNDS, GROUNDS_LIST, STATUS_LABEL, OPEN_STATUSES } from "@/app/lib/eviction";
import { waLink } from "@/app/lib/phone";
import { displayBalance, balanceTone } from "@/app/lib/balance-display";
import { requireModule } from "@/app/lib/permissions";

function periodParam(d: Date) {
  const dt = new Date(d);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default async function LeaseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  requireModule(s, "leases");
  const { id } = await params;
  const { error } = await searchParams;
  const lease = await getLease(s.organizationId, id);
  if (!lease) notFound();

  const balance = leaseBalance(lease);
  const totalCharged = lease.charges.reduce((s, c) => s + c.amount, 0);
  const totalPaid = lease.payments.reduce((s, p) => s + p.amount, 0);
  const settled = allocate(lease.charges, lease.payments);
  const openCharges = lease.charges.filter((c) => !(settled.get(c.id)?.settled ?? false));

  const latestEviction = await prisma.eviction.findFirst({
    where: { leaseId: lease.id, organizationId: s.organizationId },
    orderBy: { createdAt: "desc" },
  });
  const openEviction = latestEviction && OPEN_STATUSES.includes(latestEviction.status) ? latestEviction : null;

  const payOptions = await mpesaPayOptionsForLease(s.organizationId, lease.id);
  const mpesaReady = payOptions.stkReady || payOptions.directReady;

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${h.get("host")}`;
  const firstName = lease.tenant.name.split(" ")[0];
  const statementWa = waLink(lease.tenant.phone, `Dear ${firstName}, here is your account statement: ${origin}/api/statement/${lease.id}`);
  const agreementWa = waLink(lease.tenant.phone, `Dear ${firstName}, here is your tenancy agreement: ${origin}/api/agreement/${lease.id}`);
  const invoicePeriods = [...new Set(lease.charges.map((c) => periodParam(c.periodMonth)))].sort().reverse();
  const currentPeriod = periodParam(new Date());
  const piiVisible = canViewTenantPII(s.role);
  const tenantDisplayName = maskTenantName(lease.tenant.name, piiVisible);

  return (
    <div className="flex flex-col gap-8">
      {error && <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div>
        <Link href="/leases" className="text-xs underline text-silver-dark">
          All leases
        </Link>
        <div className="mt-1 flex items-start justify-between">
          <h1 className="text-lg font-semibold">
            {tenantDisplayName} — {lease.unit.property.name} / {lease.unit.label}
          </h1>
          <Link href={`/leases/${lease.id}/edit`} className="text-xs underline text-silver-dark">
            Edit lease
          </Link>
        </div>
        <p className="text-sm text-silver-dark">
          {lease.status} ·{" "}
          {lease.signedAt ? `Signed ${new Date(lease.signedAt).toLocaleDateString()} by ${lease.signedByName}` : "Not yet signed"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Monthly rent</div>
          <div className="mt-1 text-xl font-semibold">{money(lease.monthlyRent)}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Total charged</div>
          <div className="mt-1 text-xl font-semibold">{money(totalCharged)}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Total paid</div>
          <div className="mt-1 text-xl font-semibold text-green-700">{money(totalPaid)}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">{balance > 0 ? "Balance owed" : "Balance"}</div>
          <div className={`mt-1 text-xl font-semibold ${balanceTone(balance)}`}>{money(displayBalance(balance))}</div>
        </div>
      </div>

      <div>
        <h2 className="font-semibold">Documents</h2>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div className="rounded border p-3">
            <p className="text-sm font-medium">Account statement</p>
            <p className="mt-0.5 text-xs text-silver-dark">Full history of charges and payments on this lease.</p>
            <div className="mt-2 flex items-center gap-3">
              <a href={`/api/statement/${lease.id}`} target="_blank" rel="noreferrer" className="rounded border px-3 py-1.5 text-xs transition-colors hover:bg-silver-light">
                View / print
              </a>
              {statementWa ? (
                <a href={statementWa} target="_blank" rel="noreferrer" className="text-xs underline text-silver-dark">
                  Send on WhatsApp
                </a>
              ) : (
                <span className="text-xs text-silver-dark">No phone on file</span>
              )}
            </div>
          </div>

          <div className="rounded border p-3">
            <p className="text-sm font-medium">Tenancy agreement</p>
            <p className="mt-0.5 text-xs text-silver-dark">
              {lease.signedAt ? `Signed ${new Date(lease.signedAt).toLocaleDateString()} by ${lease.signedByName}.` : "Not yet signed."}
            </p>
            <div className="mt-2 flex items-center gap-3">
              <a href={`/api/agreement/${lease.id}`} target="_blank" rel="noreferrer" className="rounded border px-3 py-1.5 text-xs transition-colors hover:bg-silver-light">
                View / print
              </a>
              {agreementWa ? (
                <a href={agreementWa} target="_blank" rel="noreferrer" className="text-xs underline text-silver-dark">
                  Send on WhatsApp
                </a>
              ) : (
                <span className="text-xs text-silver-dark">No phone on file</span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 rounded border p-3">
          <p className="text-sm font-medium">Invoice</p>
          <p className="mt-0.5 text-xs text-silver-dark">One per billing period — pick any month, whether or not a charge has been posted for it yet.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <form action={`/api/invoice/${lease.id}`} method="GET" target="_blank" className="flex items-center gap-2">
              <input name="period" type="month" defaultValue={currentPeriod} className="rounded border px-2 py-1.5 text-xs" />
              <button type="submit" className="rounded border px-3 py-1.5 text-xs transition-colors hover:bg-silver-light">
                Generate
              </button>
            </form>
          </div>
          {invoicePeriods.length > 0 && (
            <div className="mt-3 flex flex-col gap-1.5 border-t pt-3">
              {invoicePeriods.map((p) => {
                const wa = waLink(lease.tenant.phone, `Dear ${firstName}, here is your invoice for ${p}: ${origin}/api/invoice/${lease.id}?period=${p}`);
                return (
                  <div key={p} className="flex items-center gap-3 text-xs">
                    <span className="w-16 text-silver-dark">{p}</span>
                    <a href={`/api/invoice/${lease.id}?period=${p}`} target="_blank" rel="noreferrer" className="underline">
                      View
                    </a>
                    {wa && (
                      <a href={wa} target="_blank" rel="noreferrer" className="underline text-silver-dark">
                        WhatsApp
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <div>
          <h2 className="font-semibold">Charges</h2>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
                <th className="py-1">Period</th>
                <th className="py-1">Type</th>
                <th className="py-1">Amount</th>
                <th className="py-1"></th>
              </tr>
            </thead>
            <tbody>
              {lease.charges.map((c) => {
                const formId = `charge-${c.id}`;
                return (
                  <tr key={c.id} className="border-b">
                    <td className="py-1">
                      <form id={formId} action={updateCharge.bind(null, c.id)} />
                      <input
                        form={formId}
                        name="periodMonth"
                        type="month"
                        required
                        defaultValue={periodParam(c.periodMonth)}
                        className="w-32 rounded border px-1.5 py-1 text-xs"
                      />
                    </td>
                    <td className="py-1">
                      <select form={formId} name="type" defaultValue={c.type} className="rounded border px-1.5 py-1 text-xs">
                        {CHARGE_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {CHARGE_TYPE_LABEL[t] ?? t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1">
                      <input
                        form={formId}
                        name="amount"
                        type="number"
                        step="0.01"
                        required
                        defaultValue={c.amount}
                        className="w-24 rounded border px-1.5 py-1 text-xs"
                      />
                    </td>
                    <td className="py-1">
                      <div className="flex items-center gap-2">
                        <button form={formId} className="text-xs underline">
                          Save
                        </button>
                        <form action={deleteCharge.bind(null, c.id)}>
                          <DeleteButton confirmText="Delete this charge? This cannot be undone." />
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {lease.charges.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-2 text-silver-dark">
                    No charges yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <form action={addCharge.bind(null, lease.id)} className="mt-4 flex flex-col gap-2">
            <select name="type" className="rounded border px-3 py-2">
              {CHARGE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CHARGE_TYPE_LABEL[t] ?? t}
                </option>
              ))}
            </select>
            <input name="periodMonth" type="month" required className="rounded border px-3 py-2" />
            <input name="amount" type="number" step="0.01" required placeholder="Amount" className="rounded border px-3 py-2" />
            <input name="description" placeholder="Description (optional)" className="rounded border px-3 py-2" />
            <button type="submit" className="rounded bg-ink px-3 py-2 text-lily text-sm">
              Add charge
            </button>
          </form>
        </div>

        <div>
          <h2 className="font-semibold">Payments</h2>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
                <th className="py-1">Date</th>
                <th className="py-1">Method</th>
                <th className="py-1">Amount</th>
                <th className="py-1"></th>
              </tr>
            </thead>
            <tbody>
              {lease.payments.map((p) => {
                const chargeById = new Map(lease.charges.map((c) => [c.id, c]));
                const formId = `payment-${p.id}`;
                return (
                <tr key={p.id} className="border-b">
                  <td className="py-1">
                    <form id={formId} action={updatePayment.bind(null, p.id)} />
                    <input type="hidden" form={formId} name="reference" defaultValue={p.reference ?? ""} />
                    <input
                      form={formId}
                      name="paidAt"
                      type="date"
                      required
                      defaultValue={new Date(p.paidAt).toISOString().slice(0, 10)}
                      className="w-32 rounded border px-1.5 py-1 text-xs"
                    />
                  </td>
                  <td className="py-1">
                    <select form={formId} name="method" defaultValue={p.method ?? ""} className="rounded border px-1.5 py-1 text-xs">
                      <option value="">Method (optional)</option>
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    {p.allocations.length > 0 && (
                      <span className="block text-xs text-silver-dark">
                        {p.allocations
                          .map((a) => {
                            const c = chargeById.get(a.chargeId);
                            const label = c ? CHARGE_TYPE_LABEL[c.type] ?? c.type : "charge";
                            return `${label} ${money(a.amount)}`;
                          })
                          .join(" · ")}
                      </span>
                    )}
                  </td>
                  <td className="py-1">
                    <input
                      form={formId}
                      name="amount"
                      type="number"
                      step="0.01"
                      required
                      defaultValue={p.amount}
                      className="w-24 rounded border px-1.5 py-1 text-xs"
                    />
                  </td>
                  <td className="py-1">
                    <div className="flex items-center gap-2">
                      <button form={formId} className="text-xs underline">
                        Save
                      </button>
                      <a href={`/api/receipt/${p.id}`} target="_blank" rel="noreferrer" className="text-xs underline text-silver-dark">
                        Receipt
                      </a>
                      {(() => {
                        const wa = waLink(
                          lease.tenant.phone,
                          `Dear ${firstName}, here is your payment receipt: ${origin}/api/receipt/${p.id}`,
                        );
                        return wa ? (
                          <a href={wa} target="_blank" rel="noreferrer" className="text-xs underline text-silver-dark">
                            WhatsApp
                          </a>
                        ) : null;
                      })()}
                      <form action={deletePayment.bind(null, p.id)}>
                        <DeleteButton confirmText="Delete this payment? This cannot be undone." />
                      </form>
                    </div>
                  </td>
                </tr>
                );
              })}
              {lease.payments.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-2 text-silver-dark">
                    No payments yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <form action={recordPayment.bind(null, lease.id)} className="mt-4 flex flex-col gap-2">
            <input name="paidAt" type="date" required className="rounded border px-3 py-2" />
            <input name="amount" type="number" step="0.01" required placeholder="Amount" className="rounded border px-3 py-2" />
            <select name="method" defaultValue="" className="rounded border px-3 py-2">
              <option value="">Method (optional)</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input name="reference" placeholder="Reference (optional)" className="rounded border px-3 py-2" />
            <button type="submit" className="rounded bg-ink px-3 py-2 text-lily text-sm">
              Record payment
            </button>
          </form>

          {openCharges.length > 0 && (
            <details className="mt-3 rounded border p-3">
              <summary className="cursor-pointer text-xs font-medium text-silver-dark">
                Split this payment across specific charges
              </summary>
              <p className="mt-2 text-xs text-silver-dark">
                Say how much of the total went to which charge — e.g. 4,000 of a 4,900 M-Pesa receipt is rent, 200 is
                water. Anything left over from the total still counts toward the balance, applied to the oldest
                unpaid charge.
              </p>
              <form action={recordDirectedPayment.bind(null, lease.id)} className="mt-3 flex flex-col gap-2">
                <div className="flex flex-col gap-1.5">
                  {openCharges.map((c) => {
                    const outstanding = settled.get(c.id)?.outstanding ?? c.amount;
                    return (
                      <label key={c.id} className="flex items-center justify-between gap-2 text-xs">
                        <span>
                          {CHARGE_TYPE_LABEL[c.type] ?? c.type} —{" "}
                          {new Date(c.periodMonth).toLocaleDateString(undefined, { year: "numeric", month: "short" })}
                          <span className="ml-1 text-silver-dark">(owes {money(outstanding)})</span>
                        </span>
                        <input
                          name={`charge_${c.id}`}
                          type="number"
                          step="0.01"
                          placeholder="0"
                          className="w-28 rounded border px-2 py-1"
                        />
                      </label>
                    );
                  })}
                </div>
                <input name="paidAt" type="date" required placeholder="Date" className="mt-2 rounded border px-3 py-2 text-sm" />
                <input name="amount" type="number" step="0.01" required placeholder="Total amount received" className="rounded border px-3 py-2 text-sm" />
                <select name="method" defaultValue="" className="rounded border px-3 py-2 text-sm">
                  <option value="">Method (optional)</option>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <input name="reference" placeholder="Reference (optional)" className="rounded border px-3 py-2 text-sm" />
                <button type="submit" className="rounded bg-ink px-3 py-2 text-sm text-lily">
                  Record itemized payment
                </button>
              </form>
            </details>
          )}

          {mpesaReady && (
            <div className="mt-4 border-t pt-4">
              <h3 className="text-sm font-semibold">Pay via M-Pesa</h3>
              <div className="mt-2">
                <MpesaPayPanel
                  action={sendMpesaPrompt}
                  leaseId={lease.id}
                  defaultAmount={balance > 0 ? balance : lease.monthlyRent}
                  phone={lease.tenant.phone}
                  editablePhone
                  stkReady={payOptions.stkReady}
                  direct={{
                    ready: payOptions.directReady,
                    accountType: payOptions.accountType,
                    shortcode: payOptions.shortcode,
                    accountRef: payOptions.accountRef,
                    autoMatch: payOptions.directAutoMatch,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {lease.status === "ACTIVE" && (
        <div className="max-w-sm border-t pt-6">
          <h2 className="font-semibold">Eviction</h2>
          {openEviction ? (
            <p className="mt-2 text-sm">
              Open case —{" "}
              <Link href={`/evictions/${openEviction.id}`} className="underline">
                {STATUS_LABEL[openEviction.status] ?? openEviction.status}
              </Link>
            </p>
          ) : (
            <>
              {latestEviction && (
                <p className="mt-1 text-xs text-silver-dark">
                  Previous case:{" "}
                  <Link href={`/evictions/${latestEviction.id}`} className="underline">
                    {STATUS_LABEL[latestEviction.status] ?? latestEviction.status}
                  </Link>
                </p>
              )}
              <p className="mt-1 text-xs text-silver-dark">
                Opens a case only — nothing is served or filed yet, and no lock is ever changed without a court
                order.
              </p>
              <form action={startEviction} className="mt-3 flex flex-col gap-2">
                <input type="hidden" name="leaseId" value={lease.id} />
                <div className="flex flex-col gap-1">
                  {GROUNDS_LIST.map((code) => (
                    <label key={code} className="flex items-start gap-2 text-xs">
                      <input type="checkbox" name={`ground_${code}`} className="mt-0.5" />
                      {GROUNDS[code].label}
                    </label>
                  ))}
                </div>
                <textarea
                  name="groundsDetail"
                  placeholder="Particulars (optional)"
                  className="rounded border px-3 py-2 text-sm"
                  rows={2}
                />
                <button type="submit" className="rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
                  Start eviction case
                </button>
              </form>
            </>
          )}
        </div>
      )}

      <div className="max-w-sm border-t pt-6">
        <h2 className="font-semibold text-red-600">Delete lease</h2>
        <p className="mt-1 text-xs text-silver-dark">
          {lease.charges.length > 0 || lease.payments.length > 0
            ? "This lease has charges or payments on record — deleting is blocked to protect that history. If this is a genuine tenancy, use Edit lease to mark it ENDED instead."
            : "No charges or payments recorded yet, so this is safe to delete."}
        </p>
        <form action={deleteLease.bind(null, lease.id)} className="mt-2">
          <DeleteButton confirmText={`Delete this lease for ${tenantDisplayName}? This cannot be undone.`} />
        </form>

        {(lease.charges.length > 0 || lease.payments.length > 0) && s.role === "ADMIN" && (
          <div className="mt-4 rounded border border-red-300 bg-red-50 p-3">
            <p className="text-xs text-red-700">
              Only use this for a genuine duplicate (e.g. the same tenancy entered twice) — not for a real tenancy
              that has simply ended. This permanently removes {lease.charges.length} charge(s) and{" "}
              {lease.payments.length} payment(s) along with the lease.
            </p>
            <form action={forceDeleteLease.bind(null, lease.id)} className="mt-2">
              <DeleteButton
                confirmText={`This permanently deletes ${lease.charges.length} charge(s) and ${lease.payments.length} payment(s) for ${tenantDisplayName}, along with the lease itself. This cannot be undone. Continue?`}
                label="Force delete (removes financial history)"
              />
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
