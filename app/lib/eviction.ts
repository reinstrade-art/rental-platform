import "server-only";
import { prisma } from "./prisma";
import { leaseBalance } from "./data";
import { newDocument, drawHeader, drawRule, money, textRow, paletteFor, MARGIN, PAGE_WIDTH } from "./pdf-chrome";
import type { OrgBranding } from "./pdf-chrome";

/**
 * Eviction under Kenyan law — grounds, the notice period the law sets, and
 * the Notice to Vacate document itself.
 *
 * There is deliberately no function anywhere in this file, or called from
 * it, that ends a tenancy on its own. The system can draft the notice, hold
 * the dates, and remind the office what stage a case is at — but a lawful
 * eviction ends with a court order enforced by a bailiff, not with anything
 * this software does by itself. See recordEnforced in app/lib/actions.ts,
 * the one action that touches the lease, and only for an organization admin.
 */

export const GROUNDS = {
  ARREARS: {
    label: "Non-payment or persistent late payment of rent",
    legalText: "The Tenant has failed to pay rent as agreed, and rent remains in arrears.",
  },
  BREACH_OF_COVENANT: {
    label: "Breach of tenancy covenants",
    legalText:
      "The Tenant has breached a term of the tenancy agreement, including failing to execute a required tenancy agreement, unauthorised subletting, or unapproved structural alteration.",
  },
  NUISANCE_ILLEGAL: {
    label: "Nuisance, annoyance, or illegal activity",
    legalText:
      "The Tenant's conduct has disturbed the peaceful enjoyment of neighbouring occupants, created a safety hazard, or used the premises for an illegal or immoral purpose.",
  },
  WASTE_DAMAGE: {
    label: "Waste and damage to property",
    legalText: "The Tenant has caused intentional, negligent, or malicious damage to the premises beyond fair wear and tear.",
  },
  LEASE_EXPIRY: {
    label: "Expiry or termination of lease",
    legalText: "The term of the tenancy has expired, or a valid statutory notice of termination has lapsed without renewal.",
  },
  LANDLORD_OCCUPATION: {
    label: "Landlord's personal occupation or redevelopment",
    legalText:
      "The Landlord genuinely requires the premises for personal occupation (or that of an immediate family member) or for substantial redevelopment.",
  },
} as const;

export type GroundCode = keyof typeof GROUNDS;
export const GROUNDS_LIST = Object.keys(GROUNDS) as GroundCode[];

export const splitGrounds = (s: string): GroundCode[] =>
  s.split(",").map((x) => x.trim()).filter((x): x is GroundCode => x in GROUNDS);
export const joinGrounds = (codes: string[]): string => codes.join(",");

/** The statutory floor for a periodic monthly tenancy — never less than this. */
export const MIN_NOTICE_DAYS = 30;

/** Rejects a deadline that falls short of the statutory minimum. */
export function validNoticeDeadline(servedAt: Date, deadline: Date): boolean {
  return deadline.getTime() >= servedAt.getTime() + MIN_NOTICE_DAYS * 864e5;
}

export function earliestDeadline(servedAt: Date): Date {
  return new Date(servedAt.getTime() + MIN_NOTICE_DAYS * 864e5);
}

export const COURT_VENUE_LABEL: Record<string, string> = {
  RRT: "the Rent Restriction Tribunal",
  MAGISTRATE: "the Magistrate's Court",
  ELC: "the Environment and Land Court",
};

export const STATUS_LABEL: Record<string, string> = {
  NOTICE_DRAFT: "Notice drafted",
  NOTICE_SERVED: "Notice served",
  DISTRESS_FILED: "Distress for rent filed",
  COURT_FILED: "Suit filed",
  ORDER_OBTAINED: "Eviction order obtained",
  VACATED: "Tenant vacated",
  ENFORCED: "Enforced",
  WITHDRAWN: "Withdrawn",
};

// A case ends one of three ways: the tenant leaves on their own, a court
// officer removes them, or the office drops it — everything else is open.
export const OPEN_STATUSES = ["NOTICE_DRAFT", "NOTICE_SERVED", "DISTRESS_FILED", "COURT_FILED", "ORDER_OBTAINED"];
export const CLOSED_STATUSES = ["VACATED", "ENFORCED", "WITHDRAWN"];

/**
 * The formal Notice to Vacate, branded with the organization's own
 * letterhead (never a fixed business name — this platform is white-label).
 * Lists only the grounds actually recorded against this case — never the
 * full statutory list — because a notice citing a ground the tenant isn't
 * in breach of is not one a tribunal will uphold, and is not honest either.
 */
export async function buildNoticeDoc(organizationId: string, evictionId: string): Promise<Uint8Array | null> {
  const ev = await prisma.eviction.findFirst({
    where: { id: evictionId, organizationId },
    include: {
      lease: {
        include: { tenant: true, unit: { include: { property: true } }, charges: true, payments: true, organization: true },
      },
    },
  });
  if (!ev) return null;
  const { lease } = ev;
  const { tenant, unit, organization: org } = lease;
  const codes = splitGrounds(ev.grounds);
  const servedAt = ev.noticeServedAt ?? new Date();
  const deadline = ev.noticeDeadline ?? earliestDeadline(servedAt);
  const arrears = leaseBalance({ charges: lease.charges, payments: lease.payments });

  const { doc, page, font, bold } = await newDocument();
  const palette = paletteFor(org.brandColor);
  let y = drawHeader(page, font, bold, org as OrgBranding, "Notice to Vacate");
  y -= 10;

  textRow(page, y, [
    { text: "TO:", x: MARGIN, font: bold, size: 9, color: palette.muted },
    { text: tenant.name, x: MARGIN + 40, font: bold, size: 10 },
  ]);
  y -= 15;
  textRow(page, y, [{ text: `${unit.property.name}, Unit ${unit.label}`, x: MARGIN + 40, font, size: 9.5 }]);
  y -= 28;

  // Arrears, if that is one of the grounds — the figure a tribunal will ask
  // for first, so it belongs where it cannot be missed.
  if (codes.includes("ARREARS") && arrears > 0) {
    const boxH = 46;
    page.drawRectangle({ x: MARGIN - 10, y: y - boxH + 22, width: PAGE_WIDTH - 2 * MARGIN + 20, height: boxH, color: palette.rule });
    page.drawRectangle({ x: MARGIN - 10, y: y - boxH + 22, width: 3, height: boxH, color: palette.accent });
    textRow(page, y + 2, [{ text: "ARREARS OUTSTANDING", x: MARGIN + 4, font: bold, size: 7.5, color: palette.muted }]);
    textRow(page, y - 22, [{ text: `KES ${money(arrears)}`, x: MARGIN + 4, font: bold, size: 18, color: palette.ink }]);
    y -= boxH + 10;
  }

  const maxWidth = PAGE_WIDTH - MARGIN * 2;
  const wrap = (text: string, f: typeof font, size: number) => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const trial = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(trial, size) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = trial;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  const opening = wrap(
    "TAKE NOTICE that, pursuant to the tenancy agreement between you and the Landlord, and in accordance " +
      `with the law, you are hereby required to vacate and deliver up vacant possession of the above premises ` +
      `on or before ${deadline.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}, ` +
      "on the following ground(s):",
    font,
    9.5,
  );
  opening.forEach((l, i) => textRow(page, y - i * 13, [{ text: l, x: MARGIN, font, size: 9.5 }]));
  y -= opening.length * 13 + 14;

  for (const code of codes) {
    const g = GROUNDS[code];
    textRow(page, y, [{ text: `•  ${g.label}`, x: MARGIN, font: bold, size: 9.5, color: palette.ink }]);
    y -= 16;
    const legal = wrap(g.legalText, font, 9);
    legal.forEach((l, i) => textRow(page, y - i * 12.5, [{ text: l, x: MARGIN + 14, font, size: 9, color: palette.muted }]));
    y -= legal.length * 12.5 + 6;
  }

  if (ev.groundsDetail) {
    y -= 8;
    textRow(page, y, [{ text: "PARTICULARS:", x: MARGIN, font: bold, size: 8.5, color: palette.muted }]);
    y -= 15;
    const detail = wrap(ev.groundsDetail, font, 9);
    detail.forEach((l, i) => textRow(page, y - i * 12.5, [{ text: l, x: MARGIN, font, size: 9 }]));
    y -= detail.length * 12.5 + 10;
  }

  y -= 10;
  const closing = wrap(
    "Should you fail to vacate by the above date, the Landlord reserves the right to pursue recovery of any " +
      "arrears and to apply to the appropriate tribunal or court for an order of eviction and costs. No " +
      "self-help measure will be taken against you or your belongings; any further action will proceed " +
      "strictly through the appropriate legal channel.",
    font,
    9.5,
  );
  closing.forEach((l, i) => textRow(page, y - i * 13, [{ text: l, x: MARGIN, font, size: 9.5 }]));
  y -= closing.length * 13 + 30;

  textRow(page, y, [{ text: "For and on behalf of the Landlord:", x: MARGIN, font, size: 9, color: palette.muted }]);
  y -= 40;
  drawRule(page, y, MARGIN, MARGIN + 220);
  textRow(page, y - 12, [
    { text: "Signature", x: MARGIN, font, size: 8, color: palette.muted },
  ]);
  textRow(page, y - 30, [{ text: org.letterheadName || org.name, x: MARGIN, font, size: 9, color: palette.muted }]);

  const ref = `NTV-${ev.id.slice(-6).toUpperCase()}`;
  drawRule(page, 70);
  textRow(page, 56, [
    {
      text: `${ref} — a formal legal notice, not valid until actually served`,
      x: PAGE_WIDTH / 2 - font.widthOfTextAtSize(`${ref} — a formal legal notice, not valid until actually served`, 7.5) / 2,
      font,
      size: 7.5,
      color: palette.muted,
    },
  ]);

  return doc.save();
}

export const noticeDocName = (tenantName: string) => `Notice to Vacate - ${tenantName.replace(/[^\w\s-]/g, "").trim()}.pdf`;
