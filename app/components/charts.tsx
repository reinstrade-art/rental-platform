// Pure inline-SVG/CSS charts — no charting library — kept to this app's own
// ink/silver/lily/gold palette (see app/globals.css). The gauge's severity
// colours are hardcoded rather than pulled from a token because they need
// to stay bright/saturated against the dark page background regardless of
// which way the palette tokens point — a plain --color-green-700 etc. is
// tuned for banner text, not a thick painted arc.

const BLUE = "#3987e5"; // billed
const AQUA = "#199e70"; // collected
const TRACK = "#c3c8d1"; // empty-month bar, matches --color-silver

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

export type BilledCollected = { month: number; billed: number; collected: number; rate: number };

/**
 * A dial for one ratio against a limit. The fill carries severity and the
 * track is a dimmer step of the same colour, so the state reads across the
 * whole arc rather than from the needle alone — the number in the middle is
 * still the actual value, since an arc alone is hard to read precisely.
 */
export function Gauge({
  label,
  percent,
  caption,
  good = 90,
  fair = 70,
  higherIsBetter = true,
}: {
  label: string;
  percent: number;
  caption?: string;
  good?: number;
  fair?: number;
  higherIsBetter?: boolean;
}) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const healthy = higherIsBetter ? p >= good : p <= good;
  const middling = higherIsBetter ? p >= fair : p <= fair;
  const colour = healthy ? "#4ade80" : middling ? "#e8b93f" : "#ff6b6f";
  const state = healthy ? "Healthy" : middling ? "Watch" : "Poor";

  // 240° sweep, in the familiar dial orientation.
  const R = 52;
  const SWEEP = 240;
  const START = 150;
  const pt = (deg: number) => {
    const r = (deg * Math.PI) / 180;
    return [70 + R * Math.cos(r), 70 + R * Math.sin(r)];
  };
  const arc = (from: number, to: number) => {
    const [x1, y1] = pt(from);
    const [x2, y2] = pt(to);
    return `M ${x1} ${y1} A ${R} ${R} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
  };
  // Where the filled arc currently ends — a small light dot riding right on
  // that tip, like a needle, so the exact current value pops out against
  // the gold arc itself.
  const [needleX, needleY] = pt(START + (SWEEP * p) / 100);

  return (
    <div className="flex flex-col items-center rounded border p-4">
      <svg viewBox="0 0 140 116" className="w-full max-w-[168px]" role="img" aria-label={`${label}: ${p} percent, ${state}`}>
        <path d={arc(START, START + SWEEP)} fill="none" stroke="var(--color-gold)" strokeOpacity={0.25} strokeWidth={11} strokeLinecap="round" />
        {p > 0 && (
          <>
            <path d={arc(START, START + (SWEEP * p) / 100)} fill="none" stroke="var(--color-gold)" strokeWidth={11} strokeLinecap="round" />
            <circle cx={needleX} cy={needleY} r={5.5} fill="var(--color-ink)" stroke="var(--color-lily)" strokeWidth={1.5} />
          </>
        )}
        <text x="70" y="76" textAnchor="middle" style={{ fontSize: 26, fontWeight: 600, fill: "var(--color-ink)" }}>
          {p}%
        </text>
        <text x="70" y="94" textAnchor="middle" style={{ fontSize: 9, fill: colour, fontWeight: 600, letterSpacing: 0.4 }}>
          {state.toUpperCase()}
        </text>
      </svg>
      <p className="mt-1 text-center text-sm font-medium">{label}</p>
      {caption && <p className="mt-0.5 text-center text-xs text-silver-dark">{caption}</p>}
    </div>
  );
}

/** Billed against collected, month by month — two measures in the same unit, so they share one axis. */
export function BilledVsCollected({ data }: { data: BilledCollected[] }) {
  const peak = Math.max(...data.map((d) => Math.max(d.billed, d.collected)), 1);
  const active = data.filter((d) => d.billed || d.collected);
  const avg = active.length ? Math.round(active.reduce((s, d) => s + d.rate, 0) / active.length) : 0;

  return (
    <div className="rounded border p-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">Billed against collected</h3>
        <span className="text-xs text-silver-dark">{avg}% collected on average</span>
      </div>
      <p className="mb-5 text-sm text-silver-dark">Where the bars fall short, that month was not fully paid.</p>

      <div className="overflow-x-auto">
        <div className="flex min-w-[540px] items-end gap-2.5">
          {data.map((d) => {
            const empty = !d.billed && !d.collected;
            return (
              <div key={d.month} className="flex flex-1 flex-col items-center gap-2">
                <div className="flex h-32 w-full items-end justify-center gap-[3px]">
                  <div
                    className="w-[42%] rounded-t"
                    style={{ height: `${Math.max(1.5, (d.billed / peak) * 100)}%`, background: empty ? TRACK : BLUE }}
                  />
                  <div
                    className="w-[42%] rounded-t"
                    style={{ height: `${Math.max(1.5, (d.collected / peak) * 100)}%`, background: empty ? TRACK : AQUA }}
                  />
                </div>
                <span className="text-xs text-silver-dark">{MONTHS[d.month - 1]}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 border-t pt-3">
        <span className="flex items-center gap-1.5 text-xs text-silver-dark">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: BLUE }} />
          Billed
        </span>
        <span className="flex items-center gap-1.5 text-xs text-silver-dark">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: AQUA }} />
          Collected
        </span>
      </div>
    </div>
  );
}
