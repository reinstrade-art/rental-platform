import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getOrgTier, hasFeature } from "@/app/lib/tier";
import { prisma } from "@/app/lib/prisma";
import { getReportData, monthName } from "@/app/lib/reports";
import { requireModule } from "@/app/lib/permissions";

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; property?: string }>;
}) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  if (!hasFeature(await getOrgTier(s.organizationId), "REPORTS")) redirect("/home");
  requireModule(s, "reports");

  const sp = await searchParams;
  const now = new Date();
  const period = /^\d{4}-\d{2}$/.test(sp.period ?? "") ? sp.period! : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const propertyId = sp.property || undefined;
  const year = Number(period.slice(0, 4));
  const through = Number(period.slice(5)) - 1;

  const [data, properties] = await Promise.all([
    getReportData(s.organizationId, year, through, propertyId),
    prisma.property.findMany({ where: { organizationId: s.organizationId }, orderBy: { name: "asc" } }),
  ]);

  const pdfHref = `/api/report?period=${period}${propertyId ? `&property=${propertyId}` : ""}`;
  const qs = (p: string, prop?: string) => `/reports?period=${p}${prop ? `&property=${prop}` : ""}`;
  const monthStart = `${period}-01`;
  const monthEnd = new Date(Date.UTC(year, through + 1, 0)).toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold">Reports</h1>
          <p className="text-sm text-silver-dark">{data.periodLabel}{data.propertyName ? ` · ${data.propertyName}` : " · Whole portfolio"}</p>
        </div>
        <a href={pdfHref} target="_blank" rel="noreferrer" className="rounded bg-ink px-3 py-1.5 text-sm text-lily transition-colors hover:bg-ink-soft">
          Download PDF
        </a>
      </div>

      <div>
        <h2 className="font-semibold">Export for bookkeeping</h2>
        <p className="text-xs text-silver-dark">
          CSV files for the period shown above ({data.periodLabel}) — import into QuickBooks, Xero, Sage, Zoho
          Books, or any spreadsheet.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <a
            href={`/api/export/payments?from=${monthStart}&to=${monthEnd}`}
            className="rounded border px-3 py-1.5 text-sm transition-colors hover:bg-silver-light"
          >
            Payments CSV
          </a>
          <a
            href={`/api/export/charges?from=${monthStart}&to=${monthEnd}`}
            className="rounded border px-3 py-1.5 text-sm transition-colors hover:bg-silver-light"
          >
            Charges CSV
          </a>
          <a
            href={`/api/export/expenses?from=${monthStart}&to=${monthEnd}`}
            className="rounded border px-3 py-1.5 text-sm transition-colors hover:bg-silver-light"
          >
            Expenses CSV
          </a>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form method="GET" className="flex items-center gap-2">
          <input type="month" name="period" defaultValue={period} className="rounded border px-3 py-1.5 text-sm" />
          {propertyId && <input type="hidden" name="property" value={propertyId} />}
          <button type="submit" className="rounded border px-3 py-1.5 text-sm transition-colors hover:bg-silver-light">
            Update
          </button>
        </form>
        <span className="mx-1 text-silver-dark">·</span>
        <Link href={qs(period)} className={`rounded border px-3 py-1.5 text-xs font-medium ${!propertyId ? "border-ink bg-silver-light" : ""}`}>
          All properties
        </Link>
        {properties.map((p) => (
          <Link
            key={p.id}
            href={qs(period, p.id)}
            className={`rounded border px-3 py-1.5 text-xs font-medium ${propertyId === p.id ? "border-ink bg-silver-light" : ""}`}
          >
            {p.name}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">YTD income</div>
          <div className="mt-1 text-xl font-semibold">{money(data.ytdIncome)}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Net arrears (YTD)</div>
          <div className={`mt-1 text-xl font-semibold ${data.ytdNetArrears < 0 ? "text-red-600" : ""}`}>{money(data.ytdNetArrears)}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Total shortfall</div>
          <div className="mt-1 text-xl font-semibold">{money(data.totalShortfall)}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Collection rate</div>
          <div className="mt-1 text-xl font-semibold">{data.gauges.collectionRate}%</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Occupancy</div>
          <div className="mt-1 text-xl font-semibold">
            {data.gauges.occupancy}% ({data.gauges.occupiedUnits}/{data.gauges.totalUnits})
          </div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Expenses (YTD)</div>
          <div className="mt-1 text-xl font-semibold">{money(data.expensesTotal)}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Net cash</div>
          <div className={`mt-1 text-xl font-semibold ${data.netCash < 0 ? "text-red-600" : ""}`}>{money(data.netCash)}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Closing month</div>
          <div className="mt-1 text-xl font-semibold">{monthName(data.through)}</div>
        </div>
      </div>

      <div>
        <h2 className="font-semibold">Income by month</h2>
        <table className="mt-2 w-full max-w-md border-collapse text-sm">
          <tbody>
            {data.incomeByMonth.map((m) => (
              <tr key={m.month} className="border-b">
                <td className="py-1">{m.name}</td>
                <td className="py-1 text-right">{money(m.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <div>
          <h2 className="font-semibold">Worst payers</h2>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
                <th className="py-1">Tenant</th>
                <th className="py-1">Unit</th>
                <th className="py-1">Balance</th>
              </tr>
            </thead>
            <tbody>
              {data.worstPayers.map((r) => (
                <tr key={`${r.tenant}-${r.unit}`} className="border-b">
                  <td className="py-1">{r.tenant}</td>
                  <td className="py-1">{r.property} / {r.unit}</td>
                  <td className="py-1 text-red-600">{money(r.arrears)}</td>
                </tr>
              ))}
              {data.worstPayers.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-2 text-silver-dark">None.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div>
          <h2 className="font-semibold">Best payers</h2>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
                <th className="py-1">Tenant</th>
                <th className="py-1">Unit</th>
                <th className="py-1">Consistency</th>
              </tr>
            </thead>
            <tbody>
              {data.bestPayers.map((r) => (
                <tr key={`${r.tenant}-${r.unit}`} className="border-b">
                  <td className="py-1">{r.tenant}</td>
                  <td className="py-1">{r.property} / {r.unit}</td>
                  <td className="py-1">{r.consistency}%</td>
                </tr>
              ))}
              {data.bestPayers.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-2 text-silver-dark">None.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
