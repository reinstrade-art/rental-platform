import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { headers } from "next/headers";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getEviction } from "@/app/lib/data";
import { GROUNDS, STATUS_LABEL, COURT_VENUE_LABEL, splitGrounds, earliestDeadline } from "@/app/lib/eviction";
import { waLink } from "@/app/lib/phone";
import {
  recordNoticeServed,
  recordDistressFiled,
  recordCourtFiled,
  recordOrderObtained,
  recordEnforced,
  recordVacated,
  withdrawEviction,
} from "@/app/lib/actions";

function fmt(d: Date | string) {
  return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

const STEPS = [
  { key: "NOTICE_DRAFT", label: "Notice drafted" },
  { key: "NOTICE_SERVED", label: "Notice served" },
  { key: "COURT_FILED", label: "Suit filed" },
  { key: "ORDER_OBTAINED", label: "Order obtained" },
  { key: "ENFORCED", label: "Enforced" },
];

export default async function EvictionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  const { id } = await params;
  const { error } = await searchParams;
  const ev = await getEviction(s.organizationId, id);
  if (!ev) notFound();

  const { lease } = ev;
  const { tenant, unit } = lease;
  const codes = splitGrounds(ev.grounds);
  const closed = ["ENFORCED", "WITHDRAWN", "VACATED"].includes(ev.status);
  const isAdmin = s.role === "ADMIN";
  const today = iso(new Date());
  const defaultDeadline = iso(earliestDeadline(new Date()));
  const where = `${unit.property.name}, unit ${unit.label}`;
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  const noticeUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${h.get("host")}`}/api/eviction-notice/${ev.id}`;
  const waHref = waLink(
    tenant.phone,
    `Dear ${tenant.name.split(" ")[0]}, please find your Notice to Vacate for ${where} attached here: ${noticeUrl}`,
  );
  const stepIndex = Math.max(0, STEPS.findIndex((step) => step.key === ev.status));

  return (
    <div className="flex flex-col gap-6">
      {error && <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div>
        <Link href="/evictions" className="text-xs underline text-silver-dark">
          All evictions
        </Link>
        <div className="mt-1 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Eviction — {tenant.name}</h1>
            <p className="text-sm text-silver-dark">
              {unit.property.name} · Unit {unit.label} · opened {fmt(ev.createdAt)}
            </p>
          </div>
          <span className="rounded-full border px-3 py-1 text-xs font-medium">{STATUS_LABEL[ev.status] ?? ev.status}</span>
        </div>
      </div>

      <div className="rounded border border-t-2 border-t-gold bg-silver-light p-4 text-xs text-silver-dark">
        Self-help eviction is illegal — no lock may be changed, no utility cut, no belonging removed, except by a
        court bailiff acting on the order recorded below. Nothing in this case can be marked &quot;enforced&quot;
        without one.
      </div>

      {ev.status === "VACATED" ? (
        <div className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
          Tenant vacated on their own — case closed, {fmt(ev.vacatedAt!)}.
        </div>
      ) : (
        ev.status !== "WITHDRAWN" && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {STEPS.map((step, i) => (
              <span key={step.key} className="flex items-center gap-2">
                <span
                  className={`rounded-full border px-2.5 py-1 font-medium ${
                    i < stepIndex
                      ? "border-green-300 bg-green-50 text-green-700"
                      : i === stepIndex
                        ? "border-gold bg-silver-light text-ink"
                        : "text-silver-dark"
                  }`}
                >
                  {step.label}
                </span>
                {i < STEPS.length - 1 && <span className="text-silver-dark">→</span>}
              </span>
            ))}
          </div>
        )
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <div className="rounded border p-4">
            <h2 className="font-semibold">Grounds</h2>
            <ul className="mt-2 flex flex-col gap-2">
              {codes.map((c) => (
                <li key={c} className="rounded border bg-silver-light p-3 text-sm">
                  <p className="font-medium">{GROUNDS[c].label}</p>
                  <p className="mt-1 text-xs text-silver-dark">{GROUNDS[c].legalText}</p>
                </li>
              ))}
            </ul>
            {ev.groundsDetail && <p className="mt-3 whitespace-pre-wrap text-sm text-silver-dark">{ev.groundsDetail}</p>}
          </div>

          <div className="rounded border p-4">
            <h2 className="font-semibold">Timeline</h2>
            <ul className="mt-2 flex flex-col gap-2 text-sm text-silver-dark">
              {ev.noticeServedAt && (
                <li>
                  Notice served {fmt(ev.noticeServedAt)}
                  {ev.noticeDeliveryMethod ? ` · ${ev.noticeDeliveryMethod === "HAND_DELIVERED" ? "hand-delivered" : "registered post"}` : ""}
                  {ev.noticeDeadline ? ` · vacate by ${fmt(ev.noticeDeadline)}` : ""}
                </li>
              )}
              {ev.distressFiledAt && (
                <li>
                  Distress for rent filed {fmt(ev.distressFiledAt)}
                  {ev.auctioneerName ? ` · ${ev.auctioneerName}` : ""}
                  {ev.proclamationEnds ? ` · proclamation ends ${fmt(ev.proclamationEnds)}` : ""}
                </li>
              )}
              {ev.courtFiledAt && (
                <li>
                  Suit filed {fmt(ev.courtFiledAt)}
                  {ev.courtVenue ? ` · ${COURT_VENUE_LABEL[ev.courtVenue] ?? ev.courtVenue}` : ""}
                  {ev.caseNumber ? ` · case ${ev.caseNumber}` : ""}
                </li>
              )}
              {ev.orderObtainedAt && (
                <li>
                  Order obtained {fmt(ev.orderObtainedAt)}
                  {ev.orderVacateBy ? ` · vacant possession by ${fmt(ev.orderVacateBy)}` : ""}
                </li>
              )}
              {ev.vacatedAt && <li>Tenant vacated {fmt(ev.vacatedAt)}</li>}
              {ev.enforcedAt && (
                <li>
                  Enforced {fmt(ev.enforcedAt)}
                  {ev.bailiffName ? ` · ${ev.bailiffName}` : ""}
                  {ev.policePresent ? " · police present" : ""}
                </li>
              )}
              {ev.withdrawnAt && (
                <li>
                  Withdrawn {fmt(ev.withdrawnAt)}
                  {ev.withdrawnReason ? ` — ${ev.withdrawnReason}` : ""}
                </li>
              )}
              {!ev.noticeServedAt && <li>Nothing recorded yet.</li>}
            </ul>
          </div>

          <div className="rounded border p-4">
            <h2 className="font-semibold">Notice to Vacate</h2>
            <p className="mt-1 text-xs text-silver-dark">Lists only the grounds recorded above — never the full statutory list.</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <a
                href={`/api/eviction-notice/${ev.id}`}
                target="_blank"
                rel="noreferrer"
                className="rounded bg-ink px-4 py-2 text-sm text-lily transition-colors hover:bg-ink-soft"
              >
                Preview / print ↗
              </a>
              {!closed &&
                (waHref ? (
                  <a
                    href={waHref}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded border px-4 py-2 text-sm transition-colors hover:bg-silver-light"
                  >
                    Send on WhatsApp
                  </a>
                ) : (
                  <span className="cursor-not-allowed rounded border px-4 py-2 text-sm text-silver-dark" title="This tenant has no phone number on file">
                    No phone on file
                  </span>
                ))}
            </div>
            <p className="mt-2 text-xs text-silver-dark">
              This is a convenience copy, not the legal service itself — the notice must still be hand-delivered
              with a signed acknowledgment or sent by registered post.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          {ev.status === "NOTICE_DRAFT" && (
            <div className="rounded border p-4">
              <h2 className="font-semibold">Step 1 — Serve the notice</h2>
              <p className="mt-1 text-xs text-silver-dark">
                Minimum 30 days from the date served, for a monthly periodic tenancy. A shorter deadline is refused.
              </p>
              <form action={recordNoticeServed} className="mt-3 flex flex-col gap-2">
                <input type="hidden" name="id" value={ev.id} />
                <label className="text-xs text-silver-dark">
                  Served on
                  <input name="servedAt" type="date" defaultValue={today} required className="mt-1 w-full rounded border px-3 py-2" />
                </label>
                <label className="text-xs text-silver-dark">
                  Delivered by
                  <select name="deliveryMethod" defaultValue="HAND_DELIVERED" className="mt-1 w-full rounded border px-3 py-2">
                    <option value="HAND_DELIVERED">Hand-delivered, signed for</option>
                    <option value="REGISTERED_POST">Registered post</option>
                  </select>
                </label>
                <label className="text-xs text-silver-dark">
                  Tenant must vacate by (30 days minimum)
                  <input
                    name="deadline"
                    type="date"
                    min={defaultDeadline}
                    defaultValue={defaultDeadline}
                    required
                    className="mt-1 w-full rounded border px-3 py-2"
                  />
                </label>
                <button type="submit" className="mt-1 rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
                  Record as served
                </button>
              </form>
            </div>
          )}

          {(ev.status === "NOTICE_SERVED" || ev.status === "DISTRESS_FILED") && (
            <>
              {codes.includes("ARREARS") && ev.status === "NOTICE_SERVED" && (
                <div className="rounded border p-4">
                  <h2 className="font-semibold">Optional — Distress for rent</h2>
                  <p className="mt-1 text-xs text-silver-dark">
                    Cap 293. A licensed court auctioneer issues a 14-day proclamation before attaching movable
                    household goods to recover arrears.
                  </p>
                  <form action={recordDistressFiled} className="mt-3 flex flex-col gap-2">
                    <input type="hidden" name="id" value={ev.id} />
                    <label className="text-xs text-silver-dark">
                      Filed on
                      <input name="filedAt" type="date" defaultValue={today} className="mt-1 w-full rounded border px-3 py-2" />
                    </label>
                    <label className="text-xs text-silver-dark">
                      Auctioneer
                      <input name="auctioneerName" placeholder="Licensed auctioneer's name" className="mt-1 w-full rounded border px-3 py-2" />
                    </label>
                    <button type="submit" className="mt-1 rounded border px-3 py-2 text-sm transition-colors hover:bg-silver-light">
                      Record distress filed
                    </button>
                  </form>
                </div>
              )}

              <div className="rounded border p-4">
                <h2 className="font-semibold">Step 2 — File suit</h2>
                <p className="mt-1 text-xs text-silver-dark">
                  Once the notice period has expired without compliance.
                  {ev.noticeDeadline ? ` Deadline was ${fmt(ev.noticeDeadline)}.` : ""}
                </p>
                <form action={recordCourtFiled} className="mt-3 flex flex-col gap-2">
                  <input type="hidden" name="id" value={ev.id} />
                  <label className="text-xs text-silver-dark">
                    Filed on
                    <input name="filedAt" type="date" defaultValue={today} className="mt-1 w-full rounded border px-3 py-2" />
                  </label>
                  <label className="text-xs text-silver-dark">
                    Venue
                    <select name="courtVenue" required defaultValue="" className="mt-1 w-full rounded border px-3 py-2">
                      <option value="" disabled>
                        Select…
                      </option>
                      <option value="RRT">Rent Restriction Tribunal</option>
                      <option value="MAGISTRATE">Magistrate&rsquo;s Court</option>
                      <option value="ELC">Environment and Land Court</option>
                    </select>
                  </label>
                  <label className="text-xs text-silver-dark">
                    Case number
                    <input name="caseNumber" className="mt-1 w-full rounded border px-3 py-2" />
                  </label>
                  <button type="submit" className="mt-1 rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
                    Record suit filed
                  </button>
                </form>
              </div>
            </>
          )}

          {ev.status === "COURT_FILED" && (
            <div className="rounded border p-4">
              <h2 className="font-semibold">Step 3 — Eviction order</h2>
              <p className="mt-1 text-xs text-silver-dark">Never proceed without a formal order from the tribunal or court.</p>
              <form action={recordOrderObtained} className="mt-3 flex flex-col gap-2">
                <input type="hidden" name="id" value={ev.id} />
                <label className="text-xs text-silver-dark">
                  Obtained on
                  <input name="obtainedAt" type="date" defaultValue={today} className="mt-1 w-full rounded border px-3 py-2" />
                </label>
                <label className="text-xs text-silver-dark">
                  Vacant possession by
                  <input name="vacateBy" type="date" required className="mt-1 w-full rounded border px-3 py-2" />
                </label>
                <button type="submit" className="mt-1 rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
                  Record order obtained
                </button>
              </form>
            </div>
          )}

          {ev.status === "ORDER_OBTAINED" && (
            <div className="rounded border p-4">
              <h2 className="font-semibold">Step 4 — Enforce</h2>
              <p className="mt-1 text-xs text-silver-dark">
                Carried out by a court bailiff, with police assistance if required — never by the landlord directly.
                This ends the tenancy. {isAdmin ? "" : "Only an organization admin may record this step."}
              </p>
              {isAdmin ? (
                <form action={recordEnforced} className="mt-3 flex flex-col gap-2">
                  <input type="hidden" name="id" value={ev.id} />
                  <label className="text-xs text-silver-dark">
                    Bailiff / auctioneer
                    <input name="bailiffName" className="mt-1 w-full rounded border px-3 py-2" />
                  </label>
                  <label className="flex items-center gap-2 text-sm text-silver-dark">
                    <input type="checkbox" name="policePresent" />
                    Police assistance was present
                  </label>
                  <button type="submit" className="mt-1 rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
                    Record enforced
                  </button>
                </form>
              ) : (
                <p className="mt-3 text-xs text-silver-dark">Ask your organization admin to record enforcement.</p>
              )}
            </div>
          )}

          {!closed && (
            <div className="rounded border border-green-300 bg-green-50 p-4">
              <h2 className="font-semibold">Tenant vacated on their own</h2>
              <p className="mt-1 text-xs text-silver-dark">The most common way a case ends — recorded whenever it happens, whichever stage the case is at.</p>
              <form action={recordVacated} className="mt-3 flex flex-col gap-2">
                <input type="hidden" name="id" value={ev.id} />
                <label className="text-xs text-silver-dark">
                  Vacated on
                  <input name="vacatedAt" type="date" defaultValue={today} className="mt-1 w-full rounded border px-3 py-2" />
                </label>
                <button type="submit" className="mt-1 rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
                  Record tenant vacated
                </button>
              </form>
            </div>
          )}

          {!closed && (
            <div className="rounded border p-4">
              <form action={withdrawEviction} className="flex flex-col gap-2">
                <input type="hidden" name="id" value={ev.id} />
                <label className="text-xs text-silver-dark">
                  Withdraw this case
                  <input name="reason" placeholder="e.g. tenant paid arrears in full" className="mt-1 w-full rounded border px-3 py-2" />
                </label>
                <button type="submit" className="mt-1 rounded border px-3 py-2 text-sm text-silver-dark transition-colors hover:border-red-300 hover:text-red-600">
                  Withdraw case
                </button>
              </form>
            </div>
          )}

          <div className="rounded border p-4">
            <h2 className="font-semibold">Tenancy</h2>
            <Link href={`/leases/${lease.id}`} className="text-sm underline">
              Open the lease ↗
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
