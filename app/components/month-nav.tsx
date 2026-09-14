import Link from "next/link";

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Year-arrows + month-pills navigation, sharing one URL shape (`?period=YYYY-MM`) across every page that uses it. */
export function MonthNav({ basePath, period }: { basePath: string; period: string }) {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const qs = (p: string) => `${basePath}?period=${p}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={qs(`${year - 1}-${String(month).padStart(2, "0")}`)}
        className="rounded border px-3 py-1.5 text-xs transition-colors hover:bg-silver-light"
      >
        ← {year - 1}
      </Link>
      <span className="rounded border border-gold bg-gold/10 px-3 py-1.5 text-xs font-semibold">{year}</span>
      <Link
        href={qs(`${year + 1}-${String(month).padStart(2, "0")}`)}
        className="rounded border px-3 py-1.5 text-xs transition-colors hover:bg-silver-light"
      >
        {year + 1} →
      </Link>
      <span className="mx-1 text-silver-dark">·</span>
      {MONTHS_SHORT.map((m, i) => {
        const mp = `${year}-${String(i + 1).padStart(2, "0")}`;
        const selected = mp === period;
        return (
          <Link
            key={m}
            href={qs(mp)}
            className={`rounded border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              selected ? "border-ink bg-silver-light" : "hover:bg-silver-light"
            }`}
          >
            {m}
          </Link>
        );
      })}
    </div>
  );
}
