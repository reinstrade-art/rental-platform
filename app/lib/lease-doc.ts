import "server-only";
import { newDocument, drawHeader, drawRule, money, textRow, paletteFor, MARGIN, PAGE_WIDTH, PAGE_HEIGHT } from "./pdf-chrome";
import type { OrgBranding } from "./pdf-chrome";

export type LeaseDocInput = {
  org: OrgBranding & { leaseTermsTemplate: string | null };
  tenant: { name: string; phone: string | null; email: string | null };
  unit: { label: string };
  property: { name: string };
  monthlyRent: number;
  depositAmount: number;
  startDate: Date;
  signature: {
    signatureImage: string | null;
    signedAt: Date | null;
    signedByName: string | null;
    signedIp: string | null;
  };
};

const PLACEHOLDER_TERMS =
  "No lease terms have been entered for this organization yet. Add them in Settings → Lease terms before " +
  "sending this agreement to a tenant — this placeholder is not a legal substitute for actual terms.";

/**
 * Fills {{token}} placeholders in an org's own lease terms text with this
 * lease's real values — e.g. "{{unit}}" becomes "A4". Case-insensitive,
 * whitespace inside the braces is ignored. An org's template is free text
 * they wrote themselves (often pasted from an existing paper form with
 * blank lines like "PROPERTY:………"), so any token not present in the text
 * is simply never touched — this never invents or requires a particular
 * template shape.
 */
export function fillLeaseTermsTokens(text: string, tokens: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (match, name: string) => {
    const value = tokens[name.toLowerCase()];
    return value !== undefined ? value : match;
  });
}

/**
 * A tenancy agreement, filled in from the lease record.
 *
 * The factual fields (parties, property, rent, deposit) are always correct
 * because they're read from the same rows the rest of the app uses. The
 * legal terms are the organization's own text (Settings → Lease terms) —
 * this function does not draft or assume any clause, since tenancy law and
 * ordinary practice both vary by landlord and jurisdiction.
 */
export async function buildLeaseDoc(input: LeaseDocInput): Promise<Uint8Array> {
  const { doc, page, font, bold } = await newDocument();
  const palette = paletteFor(input.org.brandColor);
  let currentPage = page;
  let y = drawHeader(currentPage, font, bold, input.org, "Tenancy Agreement");

  const newPageIfNeeded = (needed: number) => {
    if (y - needed > 60) return;
    currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  };

  y -= 14;
  textRow(currentPage, y, [{ text: "PARTIES", x: MARGIN, font: bold, size: 11 }]);
  y -= 18;
  drawRule(currentPage, y);
  y -= 18;

  const landlordName = input.org.letterheadName || input.org.name;
  textRow(currentPage, y, [
    { text: "Landlord:", x: MARGIN, font, size: 9, color: palette.muted },
    { text: landlordName, x: 140, font: bold, size: 10 },
  ]);
  y -= 16;
  if (input.org.letterheadAddress) {
    textRow(currentPage, y, [{ text: input.org.letterheadAddress, x: 140, font, size: 9, color: palette.muted }]);
    y -= 16;
  }
  textRow(currentPage, y, [
    { text: "Tenant:", x: MARGIN, font, size: 9, color: palette.muted },
    { text: input.tenant.name, x: 140, font: bold, size: 10 },
  ]);
  y -= 16;
  textRow(currentPage, y, [
    { text: "Phone / Email:", x: MARGIN, font, size: 9, color: palette.muted },
    { text: [input.tenant.phone, input.tenant.email].filter(Boolean).join(" · ") || "—", x: 140, font, size: 9 },
  ]);
  y -= 28;

  textRow(currentPage, y, [{ text: "PROPERTY & RENT", x: MARGIN, font: bold, size: 11 }]);
  y -= 18;
  drawRule(currentPage, y);
  y -= 18;
  textRow(currentPage, y, [
    { text: "Property / Unit:", x: MARGIN, font, size: 9, color: palette.muted },
    { text: `${input.property.name} / ${input.unit.label}`, x: 140, font, size: 10 },
  ]);
  y -= 16;
  textRow(currentPage, y, [
    { text: "Monthly rent:", x: MARGIN, font, size: 9, color: palette.muted },
    { text: `KES ${money(input.monthlyRent)}`, x: 140, font, size: 10 },
  ]);
  y -= 16;
  textRow(currentPage, y, [
    { text: "Security deposit:", x: MARGIN, font, size: 9, color: palette.muted },
    { text: `KES ${money(input.depositAmount)}`, x: 140, font, size: 10 },
  ]);
  y -= 16;
  textRow(currentPage, y, [
    { text: "Tenancy start date:", x: MARGIN, font, size: 9, color: palette.muted },
    { text: new Date(input.startDate).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }), x: 140, font, size: 10 },
  ]);
  y -= 30;

  textRow(currentPage, y, [{ text: "TERMS", x: MARGIN, font: bold, size: 11 }]);
  y -= 18;
  drawRule(currentPage, y);
  y -= 18;

  const rawTerms = input.org.leaseTermsTemplate?.trim() || PLACEHOLDER_TERMS;
  const termsText = fillLeaseTermsTokens(rawTerms, {
    landlord: landlordName,
    tenant: input.tenant.name,
    phone: input.tenant.phone ?? "",
    email: input.tenant.email ?? "",
    property: input.property.name,
    unit: input.unit.label,
    rent: money(input.monthlyRent),
    deposit: money(input.depositAmount),
    startdate: new Date(input.startDate).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }),
  });
  const words = termsText.split(/\s+/);
  const maxWidth = PAGE_WIDTH - MARGIN * 2;
  let line = "";
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(trial, 9) > maxWidth) {
      newPageIfNeeded(16);
      textRow(currentPage, y, [{ text: line, x: MARGIN, font, size: 9 }]);
      y -= 14;
      line = word;
    } else {
      line = trial;
    }
  }
  if (line) {
    newPageIfNeeded(16);
    textRow(currentPage, y, [{ text: line, x: MARGIN, font, size: 9 }]);
    y -= 14;
  }
  y -= 20;

  // --- signature ---------------------------------------------------------
  newPageIfNeeded(120);
  textRow(currentPage, y, [{ text: "SIGNATURE", x: MARGIN, font: bold, size: 11 }]);
  y -= 18;
  drawRule(currentPage, y);
  y -= 10;

  if (input.signature.signatureImage?.startsWith("data:image/png;base64,")) {
    try {
      const bytes = Buffer.from(input.signature.signatureImage.split(",")[1], "base64");
      const img = await doc.embedPng(bytes);
      const dims = img.scale(1);
      const drawW = 160;
      const drawH = (dims.height / dims.width) * drawW;
      currentPage.drawImage(img, { x: MARGIN, y: y - drawH, width: drawW, height: Math.min(drawH, 50) });
      y -= 58;
    } catch {
      y -= 10;
    }
  } else {
    y -= 40;
  }
  drawRule(currentPage, y, MARGIN, MARGIN + 200);
  textRow(currentPage, y - 12, [{ text: "Tenant's signature", x: MARGIN, font, size: 8, color: palette.muted }]);

  if (input.signature.signedAt) {
    y -= 30;
    textRow(currentPage, y, [
      {
        text:
          `Signed electronically by ${input.signature.signedByName ?? input.tenant.name} on ` +
          `${new Date(input.signature.signedAt).toLocaleDateString()}` +
          (input.signature.signedIp ? ` from ${input.signature.signedIp}` : "") +
          ".",
        x: MARGIN,
        font,
        size: 7,
        color: palette.muted,
      },
    ]);
  } else {
    y -= 30;
    textRow(currentPage, y, [{ text: "Not yet signed.", x: MARGIN, font, size: 8, color: palette.muted }]);
  }

  return doc.save();
}

export const leaseDocName = (tenantName: string) =>
  `Tenancy Agreement - ${tenantName.replace(/[^\w\s-]/g, "").trim()}.pdf`;
