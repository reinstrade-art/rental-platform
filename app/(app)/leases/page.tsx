import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getLeases, leaseBalance } from "@/app/lib/data";
import { prisma } from "@/app/lib/prisma";

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default async function LeasesPage() {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  const leases = await getLeases(s.organizationId);

  const withBalances = await Promise.all(
    leases.map(async (l) => {
      const [charges, payments] = await Promise.all([
        prisma.charge.findMany({ where: { leaseId: l.id }, select: { amount: true } }),
        prisma.payment.findMany({ where: { leaseId: l.id }, select: { amount: true } }),
      ]);
      return { ...l, balance: leaseBalance({ charges, payments }) };
    }),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Leases</h1>
        <Link href="/leases/new" className="rounded bg-ink px-3 py-1.5 text-sm text-lily transition-colors hover:bg-ink-soft">
          Add lease
        </Link>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-silver-dark">
            <th className="py-2">Tenant</th>
            <th className="py-2">Unit</th>
            <th className="py-2">Monthly rent</th>
            <th className="py-2">Status</th>
            <th className="py-2">Balance</th>
          </tr>
        </thead>
        <tbody>
          {withBalances.map((l) => (
            <tr key={l.id} className="border-b">
              <td className="py-2">{l.tenant.name}</td>
              <td className="py-2">
                <Link href={`/leases/${l.id}`} className="underline">
                  {l.unit.property.name} / {l.unit.label}
                </Link>
              </td>
              <td className="py-2">{money(l.monthlyRent)}</td>
              <td className="py-2">{l.status}</td>
              <td className={`py-2 ${l.balance > 0 ? "text-red-600" : ""}`}>{money(l.balance)}</td>
            </tr>
          ))}
          {withBalances.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-silver-dark">
                No leases yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
