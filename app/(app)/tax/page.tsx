import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { requireModule } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import { getMriSummary, MRI_RATE, MRI_ANNUAL_MIN, MRI_ANNUAL_MAX } from "@/app/lib/tax";

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function dateLabel(d: Date) {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export default async function TaxPage() {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  requireModule(s, "tax");
  // Rent totals and a tax liability — the office's own finances, not for read-only seats.
  if (s.role !== "ADMIN" && s.role !== "MANAGER") redirect("/home");

  const [rows, org] = await Promise.all([
    getMriSummary(s.organizationId, 12),
    prisma.organization.findUniqueOrThrow({ where: { id: s.organizationId }, select: { kraPin: true } }),
  ]);

  const now = new Date();
  const last12 = rows.reduce((sum, r) => sum + r.grossRent, 0);
  // The filing that is next due: last calendar month's rent, due on the 20th of this month.
  const lastMonth = rows[1];
  const nextDue = lastMonth?.dueDate;
  const daysLeft = nextDue ? Math.ceil((nextDue.getTime() - now.getTime()) / 86_400_000) : null;

  const band =
    last12 < MRI_ANNUAL_MIN
      ? `Rent received over the last 12 months is below KES ${money(MRI_ANNUAL_MIN)}, the level at which MRI normally starts to apply.`
      : last12 > MRI_ANNUAL_MAX
        ? `Rent received over the last 12 months is above KES ${money(MRI_ANNUAL_MAX)}. Income above that is generally taxed under a different regime — speak to your tax adviser.`
        : `Rent received over the last 12 months (KES ${money(last12)}) falls inside the MRI band of KES ${money(MRI_ANNUAL_MIN)} – ${money(MRI_ANNUAL_MAX)}.`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">KRA rental income tax (MRI)</h1>
        <p className="mt-1 max-w-2xl text-sm text-silver-dark">
          Monthly Rental Income tax is {(MRI_RATE * 100).toFixed(1)}% of the gross rent you received in a month — no
          expenses deducted — filed and paid by the 20th of the following month on KRA&apos;s iTax / eRITS. These figures
          are worked out from your recorded payments so you can file without a spreadsheet.
        </p>
      </div>

      {!org.kraPin && (
        <div className="max-w-2xl rounded border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-800">
          No KRA PIN on file yet. Add it under{" "}
          <Link href="/settings" className="underline">
            Settings → Document branding
          </Link>{" "}
          and it prints on every receipt and invoice.
        </div>
      )}

      {nextDue && lastMonth && (
        <div className="max-w-2xl rounded border p-4">
          <div className="text-xs uppercase tracking-wide text-silver-dark">Next filing</div>
          <div className="mt-1 text-lg font-semibold">
            KES {money(lastMonth.mri)} <span className="text-sm font-normal text-silver-dark">on {lastMonth.label} rent of KES {money(lastMonth.grossRent)}</span>
          </div>
          <div className={`mt-1 text-sm ${daysLeft !== null && daysLeft < 0 ? "text-red-600" : daysLeft !== null && daysLeft <= 5 ? "text-orange-600" : "text-silver-dark"}`}>
            {daysLeft !== null && daysLeft < 0
              ? `The due date, ${dateLabel(nextDue)}, has passed — file now if you haven't already; late filing carries a penalty.`
              : `Due by ${dateLabel(nextDue)}${daysLeft !== null ? ` (${daysLeft} day${daysLeft === 1 ? "" : "s"} left)` : ""}.`}
          </div>
        </div>
      )}

      <p className="max-w-2xl text-sm text-silver-dark">{band}</p>

      <table className="w-full max-w-2xl border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
            <th className="py-2">Rent received in</th>
            <th className="py-2 text-right">Gross rent (KES)</th>
            <th className="py-2 text-right">MRI ({(MRI_RATE * 100).toFixed(1)}%)</th>
            <th className="py-2 text-right">Due by</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.period} className="border-b">
              <td className="py-2">{r.label}</td>
              <td className="py-2 text-right">{money(r.grossRent)}</td>
              <td className="py-2 text-right font-medium">{money(r.mri)}</td>
              <td className="py-2 text-right text-silver-dark">{dateLabel(r.dueDate)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="py-2 font-semibold">Last 12 months</td>
            <td className="py-2 text-right font-semibold">{money(last12)}</td>
            <td className="py-2 text-right font-semibold">{money(Math.round(last12 * MRI_RATE))}</td>
            <td />
          </tr>
        </tfoot>
      </table>

      <div className="max-w-2xl rounded border bg-silver-light p-4 text-xs text-silver-dark">
        <p className="font-medium text-ink">What this does and doesn&apos;t cover</p>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>
            Only rent counts: deposits, water, hygiene and late fees are left out, and a payment covering several
            things is split the same way the rest of the app settles it. If some of your units are commercial, that
            income isn&apos;t MRI — subtract it.
          </li>
          <li>
            Receipts and invoices carry your KRA PIN, but this system does not submit anything to KRA&apos;s eTIMS or
            eRITS for you — you still register and file there.
          </li>
          <li>Rates, thresholds and deadlines are as published by KRA in 2026; confirm them at kra.go.ke before filing.</li>
        </ul>
      </div>
    </div>
  );
}
