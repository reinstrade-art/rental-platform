import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getLease, leaseBalance } from "@/app/lib/data";
import { addCharge, recordPayment } from "@/app/lib/actions";
import { CHARGE_TYPES } from "@/app/lib/constants";

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

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold">
          {lease.tenant.name} — {lease.unit.property.name} / {lease.unit.label}
        </h1>
        <p className="text-sm text-gray-500">
          {money(lease.monthlyRent)}/month · {lease.status} · Balance:{" "}
          <span className={balance > 0 ? "text-red-600 font-medium" : ""}>{money(balance)}</span>
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <div>
          <h2 className="font-semibold">Charges</h2>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
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
                  <td colSpan={4} className="py-2 text-gray-500">
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
              className="mr-3 text-xs underline text-gray-600"
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
            <button type="submit" className="rounded bg-black px-3 py-2 text-white text-sm">
              Add charge
            </button>
          </form>
        </div>

        <div>
          <h2 className="font-semibold">Payments</h2>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
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
                    <Link href={`/api/receipt/${p.id}`} target="_blank" className="text-xs underline text-gray-600">
                      Receipt
                    </Link>
                  </td>
                </tr>
              ))}
              {lease.payments.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-2 text-gray-500">
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
            <button type="submit" className="rounded bg-black px-3 py-2 text-white text-sm">
              Record payment
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
