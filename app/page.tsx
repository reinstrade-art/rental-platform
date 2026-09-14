import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, needsPlatformSetup } from "@/app/lib/auth";
import { isPlatformAdmin, isStaff, isTenant, isTradesman } from "@/app/lib/roles";

const FLOW = [
  { num: "01", label: "BILL", title: "Monthly billing run", body: "Raises rent across every active lease in one pass. Safe to re-run." },
  { num: "02", label: "COLLECT", title: "M-Pesa auto-match", body: "Paybill transactions match a unit by payment code. Unmatched ones queue for a fix." },
  { num: "03", label: "RECONCILE", title: "Arrears, computed", body: "Billed minus paid, this month only — never netted against an unrelated advance." },
  { num: "04", label: "ESCALATE", title: "Lawful eviction", body: "Persistent arrears open a case that walks Kenyan procedure end to end, dates logged." },
];

const MARKET = [
  { title: "Independent landlords", body: "Ten to a few hundred units, currently run from a notebook, a spreadsheet, or a caretaker's memory." },
  { title: "Small management companies", body: "A handful of staff running one or several owners' buildings, needing real role separation." },
  { title: "Family estates & trusts", body: "A portfolio changing hands between generations that needs a real paper trail, not tribal knowledge." },
];

const DEMO_LINK = "https://calendar.app.google/Dh9FSaTCbHtCD2sg7";

/**
 * The marketing landing page for a signed-out visitor — what the "Realty
 * Platform" card on reinstrade.com links into. Two genuinely different
 * layouts, not one squeezed into both: a PC visitor gets the spacious
 * editorial flyer below (DesktopLanding, unchanged); a phone-width visitor
 * gets MobileLanding — a compact, card-based read closer to the product's
 * own screens (see /home), ending in the same fixed bottom action bar
 * pattern the real app uses, so the pitch already looks like the thing
 * being pitched. Split with Tailwind breakpoints, not a device check, so
 * there's no JS to hydrate before the right one paints.
 */
function Landing() {
  return (
    <>
      <div className="hidden md:block">
        <DesktopLanding />
      </div>
      <div className="md:hidden">
        <MobileLanding />
      </div>
    </>
  );
}

function DesktopLanding() {
  return (
    <div className="min-h-screen bg-lily text-ink">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="flex items-center justify-between">
          <span className="text-lg">Reins Realty</span>
          <div className="flex items-center gap-4">
            <span className="text-xs uppercase tracking-widest text-silver-dark">Property management software · Kenya</span>
            <Link href="/login" className="text-sm text-silver-dark underline hover:text-gold">
              Sign in
            </Link>
          </div>
        </div>

        <div className="mt-10 h-0.5 w-16 bg-accent" />
        <h1 className="mt-6 text-6xl font-semibold tracking-tight text-wrap-balance">Order over chaos</h1>
        <p className="mt-6 max-w-xl text-lg text-silver-dark">
          The system of record for landlords who run their own buildings — not an agency&apos;s ledger, not a spreadsheet&apos;s.
        </p>

        <div className="mt-14 grid grid-cols-2 gap-10 border-t pt-10">
          <div>
            <div className="text-xs uppercase tracking-widest text-silver-dark">The problem</div>
            <h2 className="mt-2 text-2xl font-medium">Every landlord ends up running a shadow accounting department.</h2>
            <p className="mt-3 text-sm text-silver-dark">
              Rent comes in over M-Pesa, records live in a notebook or a spreadsheet, reminders go out over WhatsApp. It holds
              together at ten units. Past fifty, it quietly starts losing money.
            </p>
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest text-silver-dark">How it works</div>
            <h2 className="mt-2 text-2xl font-medium">One ledger, updated the moment M-Pesa confirms.</h2>
            <p className="mt-3 text-sm text-silver-dark">
              Every charge, every payment, every allocation between them lives in a single append-only ledger per lease.
            </p>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-4 gap-6 border-t pt-10">
          {FLOW.map((f) => (
            <div key={f.num}>
              <div className="text-xs tracking-widest text-silver-dark">
                {f.num} · {f.label}
              </div>
              <h3 className="mt-2 font-medium">{f.title}</h3>
              <p className="mt-1 text-sm text-silver-dark">{f.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 border-t pt-10">
          <div className="text-xs uppercase tracking-widest text-silver-dark">Who it&apos;s for</div>
          <div className="mt-4 grid grid-cols-3 gap-6">
            {MARKET.map((m) => (
              <div key={m.title}>
                <h3 className="font-medium">{m.title}</h3>
                <p className="mt-1 text-sm text-silver-dark">{m.body}</p>
              </div>
            ))}
          </div>
        </div>

        <blockquote className="mt-14 border-l-2 border-accent pl-5 text-xl italic text-silver-dark">
          &ldquo;The ledger should tell you what happened. Not the other way around.&rdquo;
        </blockquote>

        <div className="mt-16 flex flex-wrap items-end justify-between gap-6 border-t pt-8">
          <div>
            <h2 className="text-2xl font-medium">See it running on your own portfolio.</h2>
            <p className="mt-1 text-sm text-silver-dark">Web · Windows · Android — built for KES, M-Pesa &amp; Kenyan tenancy law</p>
          </div>
          <div className="flex items-center gap-5">
            <a href={DEMO_LINK} target="_blank" rel="noreferrer" className="rounded-full border border-accent px-5 py-2 text-sm hover:bg-accent/10">
              Book a demo
            </a>
            <Link href="/" className="text-sm text-silver-dark underline hover:text-gold">
              realty.reinstrade.com
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileLanding() {
  return (
    <div className="min-h-screen bg-lily pb-24 text-ink">
      <div className="px-5 pt-6">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-silver-dark">Reins Realty · Owner app</span>
          <Link href="/login" className="text-xs text-silver-dark underline hover:text-gold">
            Sign in
          </Link>
        </div>

        <div className="mt-4 h-0.5 w-12 bg-accent" />
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-wrap-balance">Order over chaos</h1>
        <p className="mt-3 text-sm text-silver-dark">
          The system of record for landlords who run their own buildings — not an agency&apos;s ledger, not a spreadsheet&apos;s.
        </p>

        <div className="mt-6 rounded-xl border border-silver bg-silver-light p-4">
          <div className="text-[10px] uppercase tracking-widest text-silver-dark">The problem</div>
          <h2 className="mt-1.5 text-base font-semibold">Every landlord ends up running a shadow accounting department.</h2>
          <p className="mt-2 text-xs text-silver-dark">
            Rent over M-Pesa, records in a notebook, reminders over WhatsApp — it holds together at ten units. Past fifty, it
            quietly starts losing money.
          </p>
        </div>

        <div className="mt-3 rounded-xl border border-silver bg-silver-light p-4">
          <div className="text-[10px] uppercase tracking-widest text-silver-dark">How it works</div>
          <h2 className="mt-1.5 text-base font-semibold">One ledger, updated the moment M-Pesa confirms.</h2>
          <div className="mt-3 flex flex-col divide-y divide-silver">
            {FLOW.map((f) => (
              <div key={f.num} className="flex items-baseline gap-3 py-2 first:pt-0 last:pb-0">
                <span className="text-[10px] tracking-widest text-silver-dark">{f.num}</span>
                <span className="min-w-0">
                  <span className="block text-xs font-medium">{f.title}</span>
                  <span className="block text-[11px] text-silver-dark">{f.body}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6">
          <div className="text-[10px] uppercase tracking-widest text-silver-dark">Who it&apos;s for</div>
          <div className="mt-2 flex flex-col gap-2">
            {MARKET.map((m) => (
              <div key={m.title} className="rounded-xl border border-silver bg-silver-light p-4">
                <h3 className="text-sm font-medium">{m.title}</h3>
                <p className="mt-1 text-xs text-silver-dark">{m.body}</p>
              </div>
            ))}
          </div>
        </div>

        <blockquote className="mt-6 border-l-2 border-accent pl-4 text-sm italic text-silver-dark">
          &ldquo;The ledger should tell you what happened. Not the other way around.&rdquo;
        </blockquote>

        <p className="mt-6 text-center text-[11px] text-silver-dark">Web · Windows · Android — built for KES, M-Pesa &amp; Kenyan tenancy law</p>
      </div>

      {/* Fixed bottom action bar — the same footprint as the real app's own
          bottom nav (see /home), so the pitch already reads like the thing
          it's pitching rather than a webpage bolted on top of it. */}
      <div className="fixed inset-x-0 bottom-0 border-t border-silver bg-silver-light px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="text-xs text-silver-dark underline hover:text-gold">
            realty.reinstrade.com
          </Link>
          <a
            href={DEMO_LINK}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-accent px-4 py-2 text-xs font-medium hover:bg-accent/10"
          >
            Book a demo
          </a>
        </div>
      </div>
    </div>
  );
}

export default async function Home() {
  const s = await getSession();
  if (s) {
    if (isPlatformAdmin(s.role)) redirect("/platform");
    if (isStaff(s.role)) redirect("/home");
    if (isTenant(s.role)) redirect("/portal");
    if (isTradesman(s.role)) redirect("/trade");
  }
  if (await needsPlatformSetup()) redirect("/setup");
  return <Landing />;
}
