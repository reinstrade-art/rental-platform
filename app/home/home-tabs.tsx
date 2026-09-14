"use client";

import { useState } from "react";

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

const MONTH_LABEL = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function HomeTabs({
  noi,
  noiChangePct,
  period,
  sparkline,
  sparkPeak,
  occupancyPct,
  occupiedUnits,
  unitCount,
  collectedPct,
  received,
  grossArrears,
}: {
  noi: number;
  noiChangePct: number | null;
  period: Date;
  sparkline: { month: number; collected: number }[];
  sparkPeak: number;
  occupancyPct: number;
  occupiedUnits: number;
  unitCount: number;
  collectedPct: number;
  received: number;
  grossArrears: number;
}) {
  const [tab, setTab] = useState<"figures" | "editorial">("figures");
  const periodLabel = period.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="mt-5">
      <div className="inline-flex rounded-lg border border-silver p-0.5 text-xs">
        <button
          type="button"
          onClick={() => setTab("figures")}
          className={`rounded-md px-3 py-1.5 font-medium transition-colors ${tab === "figures" ? "bg-accent/20 text-accent" : "text-silver-dark"}`}
        >
          Figures
        </button>
        <button
          type="button"
          onClick={() => setTab("editorial")}
          className={`rounded-md px-3 py-1.5 font-medium transition-colors ${tab === "editorial" ? "bg-accent/20 text-accent" : "text-silver-dark"}`}
        >
          Editorial
        </button>
      </div>

      {tab === "figures" ? (
        <div className="mt-3 flex flex-col gap-3">
          <div className="rounded-xl border border-silver bg-silver-light p-4">
            <div className="text-[10px] uppercase tracking-widest text-silver-dark">
              Net operating income · {periodLabel.toUpperCase()}
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-3xl font-semibold">KES {money(noi)}</span>
              {noiChangePct != null && (
                <span className={`text-xs font-medium ${noiChangePct >= 0 ? "text-green-700" : "text-red-700"}`}>
                  {noiChangePct >= 0 ? "↗" : "↘"} {Math.abs(noiChangePct)}% vs last month
                </span>
              )}
            </div>
            <div className="mt-3 flex h-10 items-end gap-1">
              {sparkline.map((m, i) => (
                <div
                  key={m.month}
                  className={`flex-1 rounded-sm ${i === sparkline.length - 1 ? "bg-accent" : "bg-silver"}`}
                  style={{ height: `${Math.max(8, (m.collected / sparkPeak) * 100)}%` }}
                />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-silver-dark">
              <span>{MONTH_LABEL[sparkline[0]?.month - 1] ?? ""}</span>
              <span>{MONTH_LABEL[sparkline[sparkline.length - 1]?.month - 1] ?? ""}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-silver bg-silver-light p-4">
              <div className="text-[10px] uppercase tracking-widest text-silver-dark">Occupancy</div>
              <div className="mt-1 text-2xl font-semibold">{occupancyPct}%</div>
              <div className="mt-0.5 text-xs text-silver-dark">
                {occupiedUnits} of {unitCount} units
              </div>
            </div>
            <div className="rounded-xl border border-silver bg-silver-light p-4">
              <div className="text-[10px] uppercase tracking-widest text-silver-dark">Collected</div>
              <div className="mt-1 text-2xl font-semibold">{collectedPct}%</div>
              <div className="mt-0.5 text-xs text-silver-dark">
                KES {money(grossArrears)} outstanding
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-silver bg-silver-light p-4 text-sm leading-relaxed text-silver-dark">
          <p>
            <span className="font-medium text-ink">{periodLabel}:</span> the portfolio brought in{" "}
            <span className="font-medium text-ink">KES {money(received)}</span>, with{" "}
            <span className="font-medium text-ink">{occupancyPct}%</span> of units occupied.
            {grossArrears > 0 ? (
              <>
                {" "}
                <span className="font-medium text-ink">KES {money(grossArrears)}</span> is still outstanding across every
                active lease.
              </>
            ) : (
              " Nothing is currently outstanding."
            )}
          </p>
        </div>
      )}
    </div>
  );
}
