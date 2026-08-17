import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getLease, leaseBalance } from "@/app/lib/data";
import { addCharge, recordPayment, startEviction } from "@/app/lib/actions";
import { sendMpesaPrompt } from "@/app/lib/mpesa-actions";
import { mpesaConfigured } from "@/app/lib/mpesa";
import { prisma } from "@/app/lib/prisma";
import { CHARGE_TYPES } from "@/app/lib/constants";
import { MpesaPay } from "@/app/components/mpesa-pay";
import { GROUNDS, GROUNDS_LIST, STATUS_LABEL, OPEN_STATUSES } from "@/app/lib/eviction";

function periodParam(d: Date) {
  const dt = new Date(d);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default async function LeaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  const { id } = await params;
  const lease = await getLease(s.organizationId, id);
  if (!lease) notFound();

  const balance = leaseBalance(lease);
  const totalCharged = lease.charges.reduce((s, c) => s + c.amount, 0);
  const totalPaid = lease.payments.reduce((s, p) => s + p.amount, 0);

  const latestEviction = await prisma.eviction.findFirst({
    where: { leaseId: lease.id, organizationId: s.organizationId },
    orderBy: { createdAt: "desc" },
  });
  const openEviction = latestEviction && OPEN_STATUSES.includes(latestEviction.status) ? latestEviction : null;

  const org = await prisma.organization.findUniqueOrThrow({ where: { id: s.organizationId } });
  const mpesaReady = mpesaConfigured({
    env: org.mpesaEnv,
    shortcode: org.mpesaShortcode,
    accountType: org.mpesaAccountType,
    consumerKey: org.mpesaConsumerKey,
    consumerSecret: org.mpesaConsumerSecret,
    passkey: org.mpesaPasskey,
  });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/leases" className="text-xs underline text-silver-dark">
          All leases
        </Link>
        <div className="mt-1 flex items-start justify-between">
          <h1 className="text-lg font-semibold">
            {lease.tenant.name} — {lease.unit.property.name} / {lease.unit.label}
          </h1>
          <Link href={`/leases/${lease.id}/edit`} className="text-xs underline text-silver-dark">
            Edit lease
          </Link>
        </div>
        <p className="text-sm text-silver-dark">{lease.status}</p>
        <div className="mt-1 flex items-center gap-3">
          <Link href={`/api/statement/${lease.id}`} target="_blank" className="text-xs underline text-silver-dark">
            Full statement
          </Link>
          <Link href={`/api/agreement/${lease.id}`} target="_blank" className="text-xs underline text-silver-dark">
            Tenancy agreement
          </Link>
          <span className="text-xs text-silver-dark">
            {lease.signedAt
              ? `Signed ${new Date(lease.signedAt).toLocaleDateString()} by ${lease.signedByName}`
              : "Not yet signed"}
          </span>
        </div>
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
          <div className={`mt-1 text-xl font-semibold ${balance > 0 ? "text-red-600" : ""}`}>{money(balance)}</div>
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
              {lease.charges.map((c) => (
                <tr key={c.id} className="border-b">
                  <td className="py-1">{new Date(c.periodMonth).toLocaleDateString(undefined, { year: "numeric", month: "short" })}</td>
                  <td className="py-1">{c.type}</td>
                  <td className="py-1">{money(c.amount)}</td>
                  <td className="py-1"></td>
                </tr>
              ))}
              {lease.charges.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-2 text-silver-dark">
                    No charges yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {[...new Set(lease.charges.map((c) => periodParam(c.periodMonth)))].map((p) => (
            <Link
              key={p}
              href={`/api/invoice/${lease.id}?period=${p}`}
              target="_blank"
              className="mr-3 text-xs underline text-silver-dark"
            >
              Invoice {p}
            </Link>
          ))}

          <form action={addCharge.bind(null, lease.id)} className="mt-4 flex flex-col gap-2">
            <select name="type" className="rounded border px-3 py-2">
              {CHARGE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
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
              {lease.payments.map((p) => (
                <tr key={p.id} className="border-b">
                  <td className="py-1">{new Date(p.paidAt).toLocaleDateString()}</td>
                  <td className="py-1">{p.method ?? "—"}</td>
                  <td className="py-1">{money(p.amount)}</td>
                  <td className="py-1">
                    <Link href={`/api/receipt/${p.id}`} target="_blank" className="text-xs underline text-silver-dark">
                      Receipt
                    </Link>
                  </td>
                </tr>
              ))}
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
            <input name="method" placeholder="Method (e.g. M-Pesa, Cash)" className="rounded border px-3 py-2" />
            <input name="reference" placeholder="Reference (optional)" className="rounded border px-3 py-2" />
            <button type="submit" className="rounded bg-ink px-3 py-2 text-lily text-sm">
              Record payment
            </button>
          </form>

          {mpesaReady && (
            <div className="mt-4 border-t pt-4">
              <h3 className="text-sm font-semibold">Send M-Pesa prompt</h3>
              <div className="mt-2">
                <MpesaPay
                  action={sendMpesaPrompt}
                  leaseId={lease.id}
                  defaultAmount={balance > 0 ? balance : lease.monthlyRent}
                  phone={lease.tenant.phone}
                  editablePhone
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
    </div>
  );
}
