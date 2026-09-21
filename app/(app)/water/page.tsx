import { redirect } from "next/navigation";
import { getSession, requireTenantsAccess, isCaretaker } from "@/app/lib/auth";
import { requireModule } from "@/app/lib/permissions";
import { tenantView } from "@/app/lib/pii";
import { canAccessTeam } from "@/app/lib/roles";
import { getWaterSheet, isPeriod } from "@/app/lib/water";
import { saveWaterReadings, setWaterRates } from "@/app/lib/actions";
import { MonthNav } from "@/app/components/month-nav";

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const num = (n: number) => String(Math.round(n * 100) / 100);

export default async function WaterPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    saved?: string;
    billed?: string;
    total?: string;
    base?: string;
    flag?: string;
    err?: string;
    rates?: string;
    error?: string;
  }>;
}) {
  const s = await getSession();
  if (!requireTenantsAccess(s)) redirect("/login");
  // A caretaker reads the meters for their own property; everyone else needs the Water module.
  const caretaker = isCaretaker(s.role);
  if (!caretaker) requireModule(s, "water");
  const v = tenantView(s); // surnames masked below manager/director/admin
  const canSetRates = !caretaker && canAccessTeam(s.role);

  const sp = await searchParams;
  const period = isPeriod(sp.period ?? "") ? sp.period! : new Date().toISOString().slice(0, 7);
  const sheet = await getWaterSheet(s.organizationId, period, caretaker ? s.propertyId : null);
  const monthName = new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Water readings</h1>
        <p className="max-w-3xl text-sm text-silver-dark">
          Enter each unit&apos;s meter reading for the month. The difference from last month, at the property&apos;s rate,
          becomes that tenant&apos;s water charge — on their statement and invoice, and they&apos;re told straight away.
        </p>
      </div>

      {sp.error && <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{sp.error}</div>}
      {sp.rates && <div className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700">Water rate saved.</div>}
      {sp.saved !== undefined && (
        <div className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700">
          Saved {sp.saved} reading(s). {Number(sp.billed) > 0 ? `${sp.billed} billed, KES ${money(Number(sp.total))} in total.` : "Nothing billed."}
          {sp.base ? ` ${sp.base} were first readings for their unit — recorded as a starting point, billing begins next month.` : ""}
        </div>
      )}
      {sp.flag && (
        <div className="rounded border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-800">
          Worth a second look — much higher than last month (a leak, or a misread digit?): {sp.flag}
        </div>
      )}
      {sp.err && <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">Not saved: {sp.err}</div>}

      <MonthNav basePath="/water" period={period} />

      {sheet.length === 0 && <p className="text-sm text-silver-dark">No properties to read meters for.</p>}

      {sheet.some((p) => p.waterRate === null) && (
        <div className="rounded border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-800">
          {canSetRates
            ? "Set the water rate for each property below before entering readings."
            : "A property has no water rate yet — ask a manager to set it before readings can be billed."}
        </div>
      )}

      {canSetRates && sheet.length > 0 && (
        <div className="max-w-2xl rounded border p-4">
          <h2 className="font-semibold">Water rate per property</h2>
          <p className="text-xs text-silver-dark">What one meter unit (usually a cubic metre) costs, and the least a unit is billed in a month.</p>
          <div className="mt-3 flex flex-col gap-2">
            {sheet.map((p) => (
              <form key={p.id} action={setWaterRates.bind(null, p.id)} className="flex flex-wrap items-end gap-2 text-sm">
                <span className="w-44 font-medium">{p.name}</span>
                <label className="text-xs text-silver-dark">
                  KES per unit
                  <input name="waterRate" type="number" min="0" step="0.01" defaultValue={p.waterRate ?? ""} required className="mt-1 block w-28 rounded border px-2 py-1.5 text-sm text-ink" />
                </label>
                <label className="text-xs text-silver-dark">
                  Minimum per month
                  <input name="waterMinCharge" type="number" min="0" step="1" defaultValue={p.waterMinCharge} className="mt-1 block w-28 rounded border px-2 py-1.5 text-sm text-ink" />
                </label>
                <button className="rounded border px-3 py-1.5 text-xs transition-colors hover:bg-silver-light">Save</button>
              </form>
            ))}
          </div>
        </div>
      )}

      {sheet.length > 0 && (
        <form action={saveWaterReadings} className="flex flex-col gap-6">
          <input type="hidden" name="period" value={period} />
          {sheet.map((p) => (
            <div key={p.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">{p.name}</h2>
                <span className="text-xs text-silver-dark">
                  {p.waterRate !== null
                    ? `KES ${num(p.waterRate)} per unit${p.waterMinCharge > 0 ? ` · minimum KES ${money(p.waterMinCharge)}` : ""}`
                    : "no rate set"}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="mt-2 w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
                      <th className="py-2">Unit</th>
                      <th className="py-2">Tenant</th>
                      <th className="py-2 text-right">Last reading</th>
                      <th className="py-2">{monthName} reading</th>
                      <th className="py-2 text-right">Used</th>
                      <th className="py-2 text-right">Billed (KES)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.units.map((u) => (
                      <tr key={u.id} className="border-b align-top">
                        <td className="py-2 font-medium">{u.label}</td>
                        <td className="py-2 text-silver-dark">{u.tenant ? v.name(u.tenant) : "Vacant"}</td>
                        <td className="py-2 text-right text-silver-dark">
                          {u.last ? num(u.last.reading) : "—"}
                          {u.last && <span className="block text-xs">{u.last.period}</span>}
                        </td>
                        <td className="py-2">
                          <input
                            name={`r_${u.id}`}
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            defaultValue={u.current?.reading ?? ""}
                            disabled={p.waterRate === null}
                            className="w-28 rounded border px-2 py-1.5 text-sm text-ink disabled:opacity-50"
                          />
                          {!u.last && !u.current && p.waterRate !== null && (
                            <label className="mt-1 block text-xs text-silver-dark">
                              First reading for this unit. Last month&apos;s figure, if you have it (bills now):
                              <input name={`s_${u.id}`} type="number" min="0" step="0.01" className="mt-0.5 block w-28 rounded border px-2 py-1 text-sm text-ink" />
                            </label>
                          )}
                          {u.last && p.waterRate !== null && (
                            <details className="mt-1 text-xs text-silver-dark">
                              <summary className="cursor-pointer">meter replaced?</summary>
                              <label className="mt-1 block">
                                New meter&apos;s opening figure
                                <input name={`o_${u.id}`} type="number" min="0" step="0.01" className="mt-0.5 block w-28 rounded border px-2 py-1 text-sm text-ink" />
                              </label>
                            </details>
                          )}
                        </td>
                        <td className="py-2 text-right">{u.current ? num(u.current.consumption) : "—"}</td>
                        <td className="py-2 text-right">
                          {u.current ? (
                            u.current.amount > 0 ? (
                              <span className="font-medium">{money(u.current.amount)}</span>
                            ) : u.current.previous === u.current.reading && !u.current.opening && u.current.consumption === 0 ? (
                              <span className="text-xs text-silver-dark">starting point</span>
                            ) : (
                              <span className="text-xs text-silver-dark">{u.tenant ? "nothing due" : "vacant, not billed"}</span>
                            )
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                    {p.units.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-3 text-silver-dark">
                          No units yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-3">
            <button type="submit" className="rounded bg-ink px-4 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
              Save readings &amp; bill
            </button>
            <span className="text-xs text-silver-dark">Leave a unit blank to skip it. Saving a month again corrects the readings and updates the same charge — it never bills twice.</span>
          </div>
        </form>
      )}
    </div>
  );
}
