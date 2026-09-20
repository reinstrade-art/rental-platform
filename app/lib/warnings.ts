import "server-only";
import { rgb, type PDFPage, type PDFFont } from "pdf-lib";
import { prisma } from "./prisma";
import { allocate } from "./settle";
import { hasFeature } from "./tier";
import { CHARGE_TYPE_LABEL } from "./constants";
import { splitGrounds, OPEN_STATUSES, MIN_NOTICE_DAYS, type GroundCode } from "./eviction";
import { newDocument, drawHeader, drawRule, money, paletteFor, MARGIN, PAGE_WIDTH, PAGE_HEIGHT } from "./pdf-chrome";
import type { OrgBranding } from "./pdf-chrome";
import { sendEmail } from "./email";
import { sendSms } from "./sms";
import { sendWhatsApp } from "./whatsapp";
import { sendPushToUser } from "./push";
import { mpesaPayOptionsForLease } from "./mpesa-pay-options";

/**
 * The step BEFORE an eviction case: a formal, documented warning.
 *
 * Why it exists. The best delinquency systems don't jump from "a reminder"
 * to "a legal notice" — they insert a written final warning with a clear
 * deadline and a record of delivery, and Kenyan practice expects the same:
 * demand or warn in writing, give a fair chance to put it right, keep proof,
 * and only then serve a Notice to Vacate and go to the tribunal or court —
 * never self-help. This file produces that letter for every eviction ground
 * and delivers it automatically.
 *
 * Two kinds of letter, because the grounds are of two kinds:
 *   FINAL_WARNING   the tenant is at fault (arrears, breach, nuisance/illegal
 *                   use, damage): "put this right by <date> or we will serve
 *                   a Notice to Vacate."
 *   ADVANCE_NOTICE  no fault (lease expiry, landlord's own occupation): an
 *                   early, courteous notice that the tenancy will end, which
 *                   must not read like an accusation.
 *
 * What it deliberately never does: start an Eviction, or serve a Notice to
 * Vacate. Those stay a human decision (see eviction.ts). The most this file
 * does is report who has been warned, whose deadline has passed and who is
 * therefore ready for the manager to consider the next step.
 *
 * These are template letters. Whether one holds up depends on the tenancy
 * agreement and the forum a case reaches; the office should have an advocate
 * review the wording before relying on it.
 */

export type WarningKind = "FINAL_WARNING" | "ADVANCE_NOTICE";

type GroundCopy = {
  /** True when the tenant is at fault — decides the letter kind and tone. */
  fault: boolean;
  /** Short name used in lists and the subject line. */
  title: string;
  /** Default days the tenant is given (fault) or notice period (no fault). */
  defaultDays: number;
  /** Whether the manager must supply particulars (what actually happened). */
  needsDetails: boolean;
  /** The paragraph that states the problem and what is required, given the deadline. */
  body: (ctx: { complyBy: string; details: string | null; amount: number | null }) => string;
};

export const WARNING_GROUNDS: Record<GroundCode, GroundCopy> = {
  ARREARS: {
    fault: true,
    title: "Rent arrears",
    defaultDays: 7,
    needsDetails: false,
    body: ({ complyBy, amount }) =>
      `Your rent is in arrears${amount ? ` by KES ${money(amount)}` : ""}. You are required to pay the full amount outstanding on or before ${complyBy}. ` +
      "If you are unable to do so, contact the office before that date so that a payment arrangement can be discussed and agreed in writing — " +
      "an arrangement made in advance is treated very differently from silence.",
  },
  BREACH_OF_COVENANT: {
    fault: true,
    title: "Breach of the tenancy agreement",
    defaultDays: 14,
    needsDetails: true,
    body: ({ complyBy, details }) =>
      `You are in breach of the tenancy agreement, in that: ${details ?? ""} ` +
      `You are required to remedy this breach fully on or before ${complyBy}.`,
  },
  NUISANCE_ILLEGAL: {
    fault: true,
    title: "Nuisance, annoyance or illegal activity",
    defaultDays: 3,
    needsDetails: true,
    body: ({ complyBy, details }) =>
      `Your conduct at the premises has disturbed the peaceful enjoyment of other occupants or breached the law, namely: ${details ?? ""} ` +
      `This must stop immediately, and in any event you must confirm in writing and demonstrate that it has stopped on or before ${complyBy}.`,
  },
  WASTE_DAMAGE: {
    fault: true,
    title: "Damage to the property",
    defaultDays: 14,
    needsDetails: true,
    body: ({ complyBy, details }) =>
      `Damage has been caused to the premises beyond fair wear and tear, namely: ${details ?? ""} ` +
      `You are required to repair the damage to the Landlord's satisfaction, or agree in writing to meet the cost of repair, on or before ${complyBy}.`,
  },
  LEASE_EXPIRY: {
    fault: false,
    title: "Expiry of the tenancy",
    defaultDays: 60,
    needsDetails: false,
    body: ({ complyBy, details }) =>
      "This letter is not a complaint about your conduct. The term of your tenancy is coming to an end and the Landlord does not intend to renew it. " +
      `You are expected to give up vacant possession of the premises on or before ${complyBy}.${details ? ` ${details}` : ""}`,
  },
  LANDLORD_OCCUPATION: {
    fault: false,
    title: "Landlord's occupation or redevelopment",
    defaultDays: 60,
    needsDetails: false,
    body: ({ complyBy, details }) =>
      "This letter is not a complaint about your conduct. The Landlord requires the premises for personal occupation, occupation by an immediate family member, or substantial redevelopment. " +
      `You are expected to give up vacant possession of the premises on or before ${complyBy}.${details ? ` ${details}` : ""}`,
  },
};

export function kindForGrounds(codes: GroundCode[]): WarningKind | null {
  const faults = codes.filter((c) => WARNING_GROUNDS[c].fault).length;
  if (faults === codes.length && codes.length > 0) return "FINAL_WARNING";
  if (faults === 0 && codes.length > 0) return "ADVANCE_NOTICE";
  return null; // a mix of fault and no-fault grounds in one letter is refused — they are different letters
}

export const KIND_LABEL: Record<string, string> = {
  FINAL_WARNING: "Final warning",
  ADVANCE_NOTICE: "Advance notice",
};

// --- the arrears picture ----------------------------------------------------

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

export type ArrearsPosition = {
  /** Everything unpaid right now. */
  balance: number;
  /** Unpaid on charges from months BEFORE this one — the debt that is genuinely a month or more old. */
  priorOutstanding: number;
  items: { label: string; outstanding: number; periodMonth: Date }[];
};

/**
 * "A month in arrears" means a whole month or more of rent is unpaid on
 * charges from previous months — not merely that this month's rent, due a few
 * days ago, hasn't landed yet. Payments are settled against charges exactly
 * as everywhere else in the app (oldest first, directed allocations honoured).
 */
export function arrearsPosition(
  charges: { id: string; type: string; description: string | null; amount: number; periodMonth: Date }[],
  payments: { id: string; amount: number; paidAt: Date; allocations?: { chargeId: string; amount: number }[] }[],
  now = new Date(),
): ArrearsPosition {
  const eat = new Date(now.getTime() + EAT_OFFSET_MS);
  const thisMonth = Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), 1);
  const settled = allocate(charges, payments);

  let balance = 0;
  let priorOutstanding = 0;
  const items: ArrearsPosition["items"] = [];
  for (const c of [...charges].sort((a, b) => a.periodMonth.getTime() - b.periodMonth.getTime())) {
    const outstanding = settled.get(c.id)?.outstanding ?? 0;
    if (outstanding <= 0.5) continue;
    balance += outstanding;
    if (c.periodMonth.getTime() < thisMonth) priorOutstanding += outstanding;
    const month = c.periodMonth.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
    items.push({ label: `${month} — ${CHARGE_TYPE_LABEL[c.type] ?? c.type}`, outstanding, periodMonth: c.periodMonth });
  }
  return { balance, priorOutstanding, items };
}

// --- the letter -------------------------------------------------------------

const longDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Nairobi" });

export async function buildWarningDoc(organizationId: string, warningId: string): Promise<Uint8Array | null> {
  const w = await prisma.tenantWarning.findFirst({
    where: { id: warningId, organizationId },
    include: {
      lease: {
        include: {
          tenant: true,
          unit: { include: { property: true } },
          organization: true,
          charges: true,
          payments: { include: { allocations: true } },
        },
      },
    },
  });
  if (!w) return null;
  const { lease } = w;
  const { tenant, unit, organization: org } = lease;
  const codes = splitGrounds(w.grounds);
  const isFinal = w.kind === "FINAL_WARNING";
  const complyBy = longDate(w.complyBy);

  const { doc, font, bold, page: firstPage } = await newDocument();
  const palette = paletteFor(org.brandColor);
  let page: PDFPage = firstPage;
  let y = drawHeader(page, font, bold, org as OrgBranding, isFinal ? "Final Warning" : "Advance Notice");
  const maxWidth = PAGE_WIDTH - MARGIN * 2;

  const ensure = (space: number) => {
    if (y - space < 90) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  };
  const wrap = (text: string, f: PDFFont, size: number, width = maxWidth) => {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/)) {
      const trial = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(trial, size) > width && line) {
        lines.push(line);
        line = word;
      } else line = trial;
    }
    if (line) lines.push(line);
    return lines;
  };
  const para = (text: string, opts: { f?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; gap?: number; indent?: number } = {}) => {
    const f = opts.f ?? font;
    const size = opts.size ?? 10;
    const lines = wrap(text, f, size, maxWidth - (opts.indent ?? 0));
    for (const l of lines) {
      ensure(size + 6);
      page.drawText(l, { x: MARGIN + (opts.indent ?? 0), y, size, font: f, color: opts.color ?? rgb(0.11, 0.13, 0.18) });
      y -= size + 4;
    }
    y -= opts.gap ?? 8;
  };

  // Addressee, date, reference.
  y -= 6;
  const ref = `WRN-${w.id.slice(-6).toUpperCase()}`;
  page.drawText(`Ref: ${ref}`, { x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(`Ref: ${ref}`, 9), y: y + 4, size: 9, font, color: palette.muted });
  para(longDate(w.createdAt), { size: 9.5, color: palette.muted, gap: 10 });
  para(`To: ${tenant.name}`, { f: bold, size: 11, gap: 2 });
  para(`${unit.property.name}, Unit ${unit.label}`, { size: 10, gap: 12 });

  const subject = isFinal
    ? `FIRST AND FINAL WARNING — ${codes.map((c) => WARNING_GROUNDS[c].title.toUpperCase()).join("; ")}`
    : `NOTICE OF INTENDED END OF TENANCY — ${codes.map((c) => WARNING_GROUNDS[c].title.toUpperCase()).join("; ")}`;
  para(subject, { f: bold, size: 10.5, color: palette.ink, gap: 12 });

  para(`Dear ${tenant.name.trim().split(/\s+/)[0]},`, { gap: 8 });
  para(
    isFinal
      ? "The Landlord writes to you formally. This is a first and final warning, and it is given so that you have a fair and documented opportunity to put the matter right before any further step is taken."
      : "The Landlord writes to give you early, written notice concerning your tenancy of the premises named above.",
  );

  // The arrears figure, where it applies — where it cannot be missed.
  // The statement is worked out as of the moment the letter was issued —
  // charges and payments recorded after that don't rewrite it. A letter that
  // changed every time it was opened (because the tenant paid, or a late fee
  // landed) would contradict the amount it states and be no use as a record.
  const asIssued = (r: { createdAt: Date }) => r.createdAt.getTime() <= w.createdAt.getTime();
  const pos = arrearsPosition(lease.charges.filter(asIssued), lease.payments.filter(asIssued), w.createdAt);
  if (codes.includes("ARREARS")) {
    const amount = w.arrearsAmount ?? pos.balance;
    ensure(58);
    page.drawRectangle({ x: MARGIN - 10, y: y - 40, width: PAGE_WIDTH - 2 * MARGIN + 20, height: 46, color: palette.rule });
    page.drawRectangle({ x: MARGIN - 10, y: y - 40, width: 3, height: 46, color: palette.accent });
    page.drawText("ARREARS OUTSTANDING", { x: MARGIN + 4, y: y - 2, size: 7.5, font: bold, color: palette.muted });
    page.drawText(`KES ${money(amount)}`, { x: MARGIN + 4, y: y - 28, size: 18, font: bold, color: palette.ink });
    y -= 58;
  }

  for (const c of codes) {
    para(WARNING_GROUNDS[c].body({ complyBy, details: w.details, amount: c === "ARREARS" ? (w.arrearsAmount ?? pos.balance) : null }));
  }

  // What is owed, month by month — arrears letters only, capped so it stays one screen.
  if (codes.includes("ARREARS") && pos.items.length > 0) {
    ensure(40);
    para("Statement of the amounts unpaid:", { f: bold, size: 9.5, gap: 3 });
    for (const item of pos.items.slice(0, 10)) {
      ensure(14);
      page.drawText(item.label, { x: MARGIN + 8, y, size: 9, font, color: rgb(0.11, 0.13, 0.18) });
      const amt = `KES ${money(item.outstanding)}`;
      page.drawText(amt, { x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(amt, 9), y, size: 9, font, color: rgb(0.11, 0.13, 0.18) });
      y -= 13;
    }
    if (pos.items.length > 10) {
      para(`…and ${pos.items.length - 10} earlier item(s).`, { size: 8.5, color: palette.muted, gap: 4 });
    }
    drawRule(page, y + 4);
    y -= 8;

    const pay = await mpesaPayOptionsForLease(organizationId, lease.id).catch(() => null);
    if (pay?.directReady && pay.shortcode) {
      para(
        pay.accountType === "TILL"
          ? `How to pay: M-Pesa, Lipa na M-Pesa, Buy Goods, Till ${pay.shortcode}. Tell the office once paid.`
          : `How to pay: M-Pesa, Lipa na M-Pesa, Pay Bill, Business No. ${pay.shortcode}, Account No. ${pay.accountRef ?? unit.label}. You can also pay from your tenant portal.`,
        { size: 9.5, color: palette.muted },
      );
    }
  }

  // The deadline, boxed.
  ensure(56);
  page.drawRectangle({ x: MARGIN - 10, y: y - 40, width: PAGE_WIDTH - 2 * MARGIN + 20, height: 46, color: palette.rule });
  page.drawRectangle({ x: MARGIN - 10, y: y - 40, width: 3, height: 46, color: palette.accent });
  page.drawText(isFinal ? "YOU MUST COMPLY BY" : "TENANCY TO END ON OR BEFORE", { x: MARGIN + 4, y: y - 2, size: 7.5, font: bold, color: palette.muted });
  page.drawText(complyBy, { x: MARGIN + 4, y: y - 28, size: 16, font: bold, color: palette.ink });
  y -= 60;

  para(
    isFinal
      ? "If this is not put right by that date, the Landlord will serve a Notice to Vacate stating the grounds and the notice period the law requires, and may recover any arrears and apply to the appropriate tribunal or court for an order and costs. " +
          "No self-help measure will be taken against you or your belongings — any further step will follow only the lawful process."
      : `A formal Notice to Vacate, giving the notice period the law and your tenancy agreement require, will follow. In the meantime, please contact the office to agree arrangements for handing over the premises and for your deposit.`,
  );
  para("If you believe this letter is mistaken, or you wish to discuss it, contact the office straight away, in writing where you can.");

  para("Yours faithfully,", { gap: 24 });
  ensure(50);
  drawRule(page, y, MARGIN, MARGIN + 200);
  y -= 13;
  para(org.letterheadName || org.name, { size: 9, color: palette.muted, gap: 2 });
  const contact = [org.letterheadPhone, org.letterheadEmail].filter(Boolean).join("  ·  ");
  if (contact) para(contact, { size: 8.5, color: palette.muted, gap: 2 });

  // Footer on the last page: reference, and honesty about how it was issued.
  const foot = `${ref} — ${w.source === "AUTO" ? "issued automatically under the office's arrears policy" : "issued by the office"} on ${longDate(w.createdAt)}. A formal letter, not a court document.`;
  drawRule(page, 70);
  page.drawText(foot, { x: PAGE_WIDTH / 2 - font.widthOfTextAtSize(foot, 7) / 2, y: 56, size: 7, font, color: palette.muted });

  return doc.save();
}

export const warningDocName = (tenantName: string, kind: string) =>
  `${kind === "FINAL_WARNING" ? "Final Warning" : "Advance Notice"} - ${tenantName.replace(/[^\w\s-]/g, "").trim()}.pdf`;

// --- delivery ---------------------------------------------------------------

/**
 * Sends the letter down every channel that can reach the tenant and records
 * which did. Same honesty rule as the Notice to Vacate: deliveredAt is set only
 * if something genuinely went out. If nothing did, the warning stays
 * undelivered and the page tells the office to serve it by hand or by
 * registered post — proof of delivery is the point of the exercise.
 */
export async function deliverWarning(organizationId: string, warningId: string, origin: string): Promise<string[]> {
  const w = await prisma.tenantWarning.findFirst({
    where: { id: warningId, organizationId },
    include: {
      lease: {
        include: {
          tenant: { include: { user: { select: { id: true, deviceTokens: { select: { id: true } } } } } },
          unit: { include: { property: true } },
          organization: true,
        },
      },
    },
  });
  if (!w) return [];

  const { tenant, unit, organization: org } = w.lease;
  const where = `${unit.property.name}, unit ${unit.label}`;
  const first = tenant.name.trim().split(/\s+/)[0];
  const link = `${origin}/api/warning/${w.id}`;
  const isFinal = w.kind === "FINAL_WARNING";
  const subject = isFinal ? `Final warning — ${where}` : `Notice about your tenancy — ${where}`;
  const orgName = org.letterheadName ?? org.name;
  const channels: string[] = [];

  if (tenant.email) {
    const pdf = await buildWarningDoc(organizationId, warningId).catch(() => null);
    const ok = await sendEmail(
      tenant.email,
      subject,
      `Dear ${first},\n\nPlease find attached ${isFinal ? "a final warning" : "a notice"} concerning ${where}. ` +
        `It is also available in your tenant portal at: ${link}\n\nRegards,\n${orgName}`,
      pdf ? [{ filename: warningDocName(tenant.name, w.kind), content: Buffer.from(pdf), contentType: "application/pdf" }] : undefined,
    ).catch(() => false);
    if (ok) channels.push("email");
  }

  const short = isFinal
    ? `${orgName}: FINAL WARNING for ${where}. Please read and act by ${longDate(w.complyBy)}: ${link}`
    : `${orgName}: an important notice about your tenancy at ${where}: ${link}`;
  if (tenant.phone) {
    if (await sendSms(tenant.phone, short).catch(() => false)) channels.push("sms");
    else if (await sendWhatsApp(tenant.phone, short).catch(() => false)) channels.push("whatsapp");
  }
  if (tenant.user && tenant.user.deviceTokens.length > 0) {
    await sendPushToUser(tenant.user.id, { title: subject, body: "Open your tenant portal to read it." }).catch(() => {});
    channels.push("push");
  }

  await prisma.tenantWarning.update({
    where: { id: w.id },
    data: { channels: channels.join(","), deliveredAt: channels.length > 0 ? new Date() : null },
  });
  return channels;
}

// --- issuing ----------------------------------------------------------------

export type IssueResult = { ok: true; warningId: string; delivered: boolean } | { ok: false; reason: string };

/** A manager chose the grounds: record the letter, then build and deliver it straight away. */
export async function issueWarning(input: {
  organizationId: string;
  leaseId: string;
  grounds: GroundCode[];
  details: string | null;
  days: number;
  issuedById: string;
  origin: string;
}): Promise<IssueResult> {
  const kind = kindForGrounds(input.grounds);
  if (!kind) return { ok: false, reason: "Choose either fault grounds (arrears, breach, nuisance, damage) or no-fault grounds (lease expiry, landlord's occupation) — they are different letters." };

  for (const g of input.grounds) {
    if (WARNING_GROUNDS[g].needsDetails && !input.details?.trim()) {
      return { ok: false, reason: `Say what happened — "${WARNING_GROUNDS[g].title}" needs particulars in the letter.` };
    }
  }
  if (kind === "ADVANCE_NOTICE" && input.days < MIN_NOTICE_DAYS) {
    return { ok: false, reason: `Notice that a tenancy will end must be at least ${MIN_NOTICE_DAYS} days.` };
  }
  if (kind === "FINAL_WARNING" && (input.days < 1 || input.days > 60)) {
    return { ok: false, reason: "Give the tenant between 1 and 60 days to put it right." };
  }

  const lease = await prisma.lease.findFirst({
    where: { id: input.leaseId, organizationId: input.organizationId, status: "ACTIVE" },
    include: { charges: true, payments: { include: { allocations: true } } },
  });
  if (!lease) return { ok: false, reason: "That lease isn't active." };

  const pos = arrearsPosition(lease.charges, lease.payments);
  const w = await prisma.tenantWarning.create({
    data: {
      organizationId: input.organizationId,
      leaseId: lease.id,
      grounds: input.grounds.join(","),
      kind,
      source: "MANUAL",
      details: input.details?.trim() || null,
      arrearsAmount: input.grounds.includes("ARREARS") ? Math.round(pos.balance) : null,
      complyBy: new Date(Date.now() + input.days * DAY_MS),
      issuedById: input.issuedById,
    },
  });
  const channels = await deliverWarning(input.organizationId, w.id, input.origin);
  return { ok: true, warningId: w.id, delivered: channels.length > 0 };
}

// --- the automatic run (daily cron) ------------------------------------------

const REWARN_COOLDOWN_DAYS = 180;

/**
 * On the org's chosen day of the month (the 11th by default), warns every
 * active tenant who is a full month or more behind — once. "Once" is the
 * point of a FINAL warning: a tenant already warned about arrears in the last
 * six months isn't warned again (the next step is a human deciding on a
 * Notice to Vacate, which the Evictions page now surfaces). The run also
 * fires on the two days after the chosen day, so a missed cron day doesn't
 * skip a month; the unique key stops a double letter either way.
 */
export async function runArrearsWarnings(now = new Date()) {
  const orgs = await prisma.organization.findMany({
    where: { status: "ACTIVE", arrearsWarningAuto: true },
    select: { id: true, tier: true, arrearsWarningDay: true, warningCureDays: true },
  });

  const eat = new Date(now.getTime() + EAT_OFFSET_MS);
  const dayOfMonth = eat.getUTCDate();
  const period = `${eat.getUTCFullYear()}-${String(eat.getUTCMonth() + 1).padStart(2, "0")}`;
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const results: { organizationId: string; warned?: number; undelivered?: number; error?: string }[] = [];

  for (const org of orgs) {
    try {
      if (!hasFeature(org.tier, "EVICTIONS")) continue;
      const runDay = Math.min(25, Math.max(1, org.arrearsWarningDay));
      if (dayOfMonth < runDay || dayOfMonth > runDay + 2) continue;

      const leases = await prisma.lease.findMany({
        where: {
          organizationId: org.id,
          status: "ACTIVE",
          evictions: { none: { status: { in: OPEN_STATUSES } } },
          tenantWarnings: { none: { grounds: { contains: "ARREARS" }, createdAt: { gte: new Date(now.getTime() - REWARN_COOLDOWN_DAYS * DAY_MS) } } },
        },
        include: { charges: true, payments: { include: { allocations: true } } },
      });

      let warned = 0;
      let undelivered = 0;
      for (const lease of leases) {
        if (lease.monthlyRent <= 0) continue;
        const pos = arrearsPosition(lease.charges, lease.payments, now);
        if (pos.priorOutstanding + 0.5 < lease.monthlyRent) continue; // not yet a full month behind

        let warningId: string;
        try {
          const w = await prisma.tenantWarning.create({
            data: {
              organizationId: org.id,
              leaseId: lease.id,
              grounds: "ARREARS",
              kind: "FINAL_WARNING",
              source: "AUTO",
              period,
              arrearsAmount: Math.round(pos.balance),
              complyBy: new Date(now.getTime() + org.warningCureDays * DAY_MS),
            },
          });
          warningId = w.id;
        } catch {
          continue; // this month's warning already exists
        }
        warned++;
        const channels = await deliverWarning(org.id, warningId, origin);
        if (channels.length === 0) undelivered++;
      }
      results.push({ organizationId: org.id, warned, undelivered });
    } catch (e) {
      results.push({ organizationId: org.id, error: e instanceof Error ? e.message : "failed" });
    }
  }
  return results;
}

// --- what the Evictions page shows ------------------------------------------

export async function getRecentWarnings(organizationId: string, take = 25) {
  return prisma.tenantWarning.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take,
    include: { lease: { select: { id: true, tenant: { select: { name: true } }, unit: { select: { label: true, property: { select: { name: true } } } } } } },
  });
}

/**
 * Tenants who were warned, whose deadline has now passed, who are still an
 * active tenancy with no eviction case open — the ones a manager should now
 * consider serving a Notice to Vacate on. Arrears warnings only qualify while
 * the arrears are actually still there; if they paid up, the warning worked
 * and they drop off the list on their own.
 */
export async function getReadyForNotice(organizationId: string, now = new Date()) {
  const warnings = await prisma.tenantWarning.findMany({
    where: {
      organizationId,
      kind: "FINAL_WARNING",
      complyBy: { lt: now },
      lease: { status: "ACTIVE", evictions: { none: { status: { in: OPEN_STATUSES } } } },
    },
    orderBy: { complyBy: "desc" },
    include: {
      lease: {
        include: {
          tenant: { select: { name: true } },
          unit: { select: { label: true, property: { select: { name: true } } } },
          charges: true,
          payments: { include: { allocations: true } },
        },
      },
    },
  });

  const seen = new Set<string>();
  const ready = [];
  for (const w of warnings) {
    if (seen.has(w.leaseId)) continue; // newest warning per lease only
    seen.add(w.leaseId);
    if (w.grounds.split(",").includes("ARREARS")) {
      const pos = arrearsPosition(w.lease.charges, w.lease.payments, now);
      if (pos.balance <= 0.5) continue; // paid up — the warning did its job
      ready.push({ warning: w, owed: pos.balance });
    } else {
      ready.push({ warning: w, owed: null as number | null });
    }
  }
  return ready;
}
