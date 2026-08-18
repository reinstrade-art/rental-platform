import "server-only";
import { PDFFont, PDFPage } from "pdf-lib";
import { newDocument, drawHeader, drawRule, embedCursive, money, textRow, paletteFor, MARGIN, PAGE_WIDTH, PAGE_HEIGHT } from "./pdf-chrome";
import type { OrgBranding, Palette } from "./pdf-chrome";

export type LeaseDocInput = {
  org: OrgBranding & {
    leaseTermsTemplate: string | null;
    mpesaShortcode: string | null;
    mpesaAccountType: string | null;
  };
  tenant: { name: string; phone: string | null; email: string | null };
  unit: { label: string; paymentCode: string | null };
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

// --- clause parsing ------------------------------------------------------
// An org's terms are free text, usually pasted from a paper form with a
// numbered/roman-numeral clause structure ("1. THE TENANT WILL:", then
// "I. Pay rent...", "II. ..."). Rendered verbatim that reads as one dense
// wall of text; parsed line-by-line into headers/items/paragraphs it reads
// like an actual legal document. A line this doesn't recognize just prints
// as a plain paragraph — nothing here requires a particular template shape.

type TermBlock = { kind: "header"; text: string } | { kind: "item"; marker: string; text: string } | { kind: "para"; text: string };

const ROMAN_ITEM = /^([IVXLCDM]+)\.\s+(.+)$/;
const NUMBERED = /^(\d+)\.?\s+(.+)$/;
const ALL_CAPS_HEAD = /^[A-Z][A-Z\s'’,.\-()]{2,59}:?$/;

function parseTermsBlocks(text: string): TermBlock[] {
  const blocks: TermBlock[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const numbered = line.match(NUMBERED);
    if (numbered && ALL_CAPS_HEAD.test(numbered[2])) {
      blocks.push({ kind: "header", text: `${numbered[1]}. ${numbered[2].replace(/:$/, "")}` });
      continue;
    }

    const roman = line.match(ROMAN_ITEM);
    if (roman) {
      blocks.push({ kind: "item", marker: `${roman[1]}.`, text: roman[2] });
      continue;
    }

    if (numbered) {
      blocks.push({ kind: "item", marker: `${numbered[1]}.`, text: numbered[2] });
      continue;
    }

    if (line.length < 60 && ALL_CAPS_HEAD.test(line)) {
      blocks.push({ kind: "header", text: line.replace(/:$/, "") });
      continue;
    }

    blocks.push({ kind: "para", text: line });
  }
  return blocks;
}

function wrapWords(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(trial, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Field label above a bold value — the repeated unit used throughout PARTIES/PROPERTY. */
function fieldRow(page: PDFPage, y: number, font: PDFFont, bold: PDFFont, palette: Palette, label: string, value: string, x = MARGIN, valueSize = 10) {
  textRow(page, y, [{ text: label.toUpperCase(), x, font: bold, size: 8, color: palette.muted }]);
  textRow(page, y - 13, [{ text: value, x, font, size: valueSize }]);
}

function sectionHeader(page: PDFPage, y: number, bold: PDFFont, palette: Palette, title: string) {
  textRow(page, y, [{ text: title.toUpperCase(), x: MARGIN, font: bold, size: 11, color: palette.accent }]);
  drawRule(page, y - 6);
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
  const landlordName = input.org.letterheadName || input.org.name;
  const subtitle = `${input.tenant.name} · ${input.property.name} ${input.unit.label}`;
  const maxWidth = PAGE_WIDTH - MARGIN * 2;

  let y = drawHeader(currentPage, font, bold, input.org, "Tenancy Agreement");

  // The landlord countersigns in script the moment the tenant has — a copy
  // that comes back with only the tenant's ink still reads as half-executed.
  // Embedded once, up front, since embedding is async and the drawing
  // helpers below are not.
  const cursive = input.signature.signedAt ? await embedCursive(doc) : null;

  const drawContinuationHeader = () => {
    let cy = PAGE_HEIGHT - MARGIN;
    textRow(currentPage, cy, [{ text: "Tenancy Agreement (continued)", x: MARGIN, font: bold, size: 18 }]);
    cy -= 20;
    textRow(currentPage, cy, [{ text: subtitle, x: MARGIN, font, size: 10, color: palette.muted }]);
    cy -= 12;
    currentPage.drawRectangle({ x: MARGIN, y: cy, width: PAGE_WIDTH - MARGIN * 2, height: 2, color: palette.accent });
    return cy - 26;
  };

  const newPageIfNeeded = (needed: number) => {
    if (y - needed > 70) return;
    currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = drawContinuationHeader();
  };

  // --- title + subtitle ---------------------------------------------------
  y -= 28;
  textRow(currentPage, y, [{ text: "Tenancy Agreement", x: MARGIN, font: bold, size: 22 }]);
  y -= 20;
  textRow(currentPage, y, [{ text: subtitle, x: MARGIN, font, size: 11, color: palette.muted }]);
  y -= 14;
  currentPage.drawRectangle({ x: MARGIN, y, width: PAGE_WIDTH - MARGIN * 2, height: 2, color: palette.accent });
  y -= 30;

  // --- PARTIES -------------------------------------------------------------
  sectionHeader(currentPage, y, bold, palette, "Parties");
  y -= 26;

  fieldRow(currentPage, y, font, bold, palette, "The Landlord", landlordName, MARGIN, 12);
  y -= 30;
  if (input.org.letterheadAddress) {
    textRow(currentPage, y, [{ text: input.org.letterheadAddress, x: MARGIN, font, size: 9, color: palette.muted }]);
    y -= 20;
  }
  drawRule(currentPage, y);
  y -= 22;

  fieldRow(currentPage, y, font, bold, palette, "The Tenant", input.tenant.name, MARGIN, 12);
  y -= 30;
  drawRule(currentPage, y);
  y -= 22;

  fieldRow(currentPage, y, font, bold, palette, "Phone Number", input.tenant.phone || "—");
  fieldRow(currentPage, y, font, bold, palette, "Email Address", input.tenant.email || "—", 320);
  y -= 30;
  drawRule(currentPage, y);
  y -= 26;

  // --- PROPERTY --------------------------------------------------------------
  fieldRow(currentPage, y, font, bold, palette, "Property", input.property.name, MARGIN, 12);
  fieldRow(currentPage, y, font, bold, palette, "Unit No.", input.unit.label, 320, 12);
  y -= 30;
  drawRule(currentPage, y);
  y -= 30;

  // --- RENT --------------------------------------------------------------
  sectionHeader(currentPage, y, bold, palette, "Rent");
  y -= 24;
  const rentLines = wrapWords(
    font,
    `Rent payable is Kenyan Shilling ${money(input.monthlyRent)} per month, payable in advance by the 1st of each month.`,
    10,
    maxWidth,
  );
  for (const line of rentLines) {
    textRow(currentPage, y, [{ text: line, x: MARGIN, font, size: 10 }]);
    y -= 15;
  }
  y -= 6;

  if (input.org.mpesaShortcode) {
    const accountLabel = input.org.mpesaAccountType === "TILL" ? "Till Number" : "Paybill";
    const payLine = `M-Pesa ${accountLabel} ${input.org.mpesaShortcode}${input.unit.paymentCode ? ` · Account ${input.unit.paymentCode}` : ""}`;
    const boxTop = y;
    currentPage.drawRectangle({ x: MARGIN, y: y - 42, width: maxWidth, height: 42, color: palette.rule, opacity: 0.35 });
    currentPage.drawRectangle({ x: MARGIN, y: y - 42, width: 3, height: 42, color: palette.accent });
    textRow(currentPage, boxTop - 14, [{ text: "PAY TO", x: MARGIN + 14, font: bold, size: 8, color: palette.muted }]);
    textRow(currentPage, boxTop - 30, [{ text: payLine, x: MARGIN + 14, font: bold, size: 11 }]);
    y -= 56;
  }
  y -= 12;

  // --- DEPOSIT -------------------------------------------------------------
  sectionHeader(currentPage, y, bold, palette, "Deposit");
  y -= 24;
  const depositLines = wrapWords(
    font,
    `On the date of commencement of this tenancy, the Tenant shall deposit with the Landlord and maintain ` +
      `throughout the term an amount equivalent to one (1) month's rent, being the initial amount of KES ` +
      `${money(input.depositAmount)}, as security for the performance by the Tenant of the Tenant's obligations ` +
      `under this Tenancy.`,
    10,
    maxWidth,
  );
  for (const line of depositLines) {
    newPageIfNeeded(16);
    textRow(currentPage, y, [{ text: line, x: MARGIN, font, size: 10 }]);
    y -= 15;
  }
  y -= 16;

  // --- TERMS (the org's own free text, parsed into headers/items/paragraphs) --
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

  newPageIfNeeded(30);
  sectionHeader(currentPage, y, bold, palette, "Terms");
  y -= 24;

  for (const block of parseTermsBlocks(termsText)) {
    if (block.kind === "header") {
      newPageIfNeeded(28);
      y -= 6;
      textRow(currentPage, y, [{ text: block.text, x: MARGIN, font: bold, size: 10, color: palette.accent }]);
      y -= 8;
      drawRule(currentPage, y);
      y -= 16;
    } else if (block.kind === "item") {
      const indent = 24;
      const lines = wrapWords(font, block.text, 10, maxWidth - indent);
      newPageIfNeeded(lines.length * 15 + 4);
      textRow(currentPage, y, [{ text: block.marker, x: MARGIN, font: bold, size: 10, color: palette.accent }]);
      for (const line of lines) {
        newPageIfNeeded(15);
        textRow(currentPage, y, [{ text: line, x: MARGIN + indent, font, size: 10 }]);
        y -= 15;
      }
      y -= 4;
    } else {
      const lines = wrapWords(font, block.text, 10, maxWidth);
      for (const line of lines) {
        newPageIfNeeded(15);
        textRow(currentPage, y, [{ text: line, x: MARGIN, font, size: 10 }]);
        y -= 15;
      }
      y -= 4;
    }
  }
  y -= 16;

  // --- EXECUTION -----------------------------------------------------------
  newPageIfNeeded(220);
  sectionHeader(currentPage, y, bold, palette, "Execution");
  y -= 26;

  const colWidth = (maxWidth - 24) / 2;
  const rightX = MARGIN + colWidth + 24;
  const topY = y;

  textRow(currentPage, y, [{ text: "THE LANDLORD", x: MARGIN, font: bold, size: 8, color: palette.muted }]);
  textRow(currentPage, y, [{ text: "THE TENANT", x: rightX, font: bold, size: 8, color: palette.muted }]);
  y -= 16;
  textRow(currentPage, y, [
    { text: landlordName, x: MARGIN, font: bold, size: 12 },
    { text: input.tenant.name, x: rightX, font: bold, size: 12 },
  ]);
  y -= 22;

  let leftY = y;
  if (input.org.letterheadAddress) {
    textRow(currentPage, leftY, [{ text: `Address: ${input.org.letterheadAddress}`, x: MARGIN, font, size: 9, color: palette.muted }]);
    leftY -= 15;
  }
  let rightY = y;
  if (input.tenant.phone) {
    textRow(currentPage, rightY, [{ text: `Phone: ${input.tenant.phone}`, x: rightX, font, size: 9, color: palette.muted }]);
    rightY -= 15;
  }

  y = Math.min(leftY, rightY) - 30;
  drawRule(currentPage, y, MARGIN, MARGIN + colWidth);
  drawRule(currentPage, y, rightX, rightX + colWidth);
  textRow(currentPage, y - 12, [
    { text: "Signature", x: MARGIN, font, size: 8, color: palette.muted },
    { text: "Signature", x: rightX, font, size: 8, color: palette.muted },
  ]);

  // Tenant's e-signature (from the portal sign-off), embedded over their line.
  if (input.signature.signatureImage?.startsWith("data:image/png;base64,")) {
    try {
      const bytes = Buffer.from(input.signature.signatureImage.split(",")[1], "base64");
      const img = await doc.embedPng(bytes);
      const dims = img.scale(1);
      const drawW = Math.min(colWidth - 10, 140);
      const drawH = Math.min((dims.height / dims.width) * drawW, 40);
      currentPage.drawImage(img, { x: rightX, y: y + 4, width: drawW, height: drawH });
    } catch {
      // signature image failed to embed — the printed line still stands
    }
  }

  // Landlord's countersignature — a script rendering of the landlord's own
  // name (the property/org's letterhead name), drawn automatically the
  // instant the tenant has signed. Not a real handwritten signature; a
  // standing authorization the office has already given by putting this
  // template in front of tenants at all, made visible on the page.
  if (cursive) {
    textRow(currentPage, y + 6, [{ text: landlordName, x: MARGIN + 4, font: cursive, size: 22 }]);
  }

  y -= 34;
  drawRule(currentPage, y, MARGIN, MARGIN + colWidth);
  drawRule(currentPage, y, rightX, rightX + colWidth);
  textRow(currentPage, y - 12, [
    {
      text: input.signature.signedAt
        ? `Date: ${new Date(input.signature.signedAt).toLocaleDateString()} (countersigned automatically)`
        : "Date",
      x: MARGIN,
      font,
      size: 8,
      color: palette.muted,
    },
    {
      text: input.signature.signedAt
        ? `Date: ${new Date(input.signature.signedAt).toLocaleDateString()} (signed electronically${input.signature.signedIp ? ` from ${input.signature.signedIp}` : ""})`
        : "Date",
      x: rightX,
      font,
      size: 8,
      color: palette.muted,
    },
  ]);

  y -= 40;
  drawRule(currentPage, y);
  y -= 26;
  textRow(currentPage, y, [{ text: "WITNESS", x: MARGIN, font: bold, size: 8, color: palette.muted }]);
  y -= 30;
  drawRule(currentPage, y, MARGIN, MARGIN + colWidth);
  drawRule(currentPage, y, rightX, rightX + colWidth);
  textRow(currentPage, y - 12, [
    { text: "Name & signature", x: MARGIN, font, size: 8, color: palette.muted },
    { text: "Date", x: rightX, font, size: 8, color: palette.muted },
  ]);
  void topY; // reserved for future alignment tweaks

  // --- footer (page X of Y), drawn last across every page now the total is known --
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    drawRule(p, MARGIN, MARGIN, PAGE_WIDTH - MARGIN);
    textRow(p, MARGIN - 14, [
      { text: "Tenancy agreement", x: MARGIN, font, size: 8, color: palette.muted },
      { text: `page ${i + 1} of ${pages.length}`, x: PAGE_WIDTH / 2 - 30, font, size: 8, color: palette.muted },
    ]);
    const orgLabel = landlordName;
    p.drawText(orgLabel, {
      x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(orgLabel, 8),
      y: MARGIN - 14,
      size: 8,
      font,
      color: palette.muted,
    });
  });

  return doc.save();
}

export const leaseDocName = (tenantName: string) =>
  `Tenancy Agreement - ${tenantName.replace(/[^\w\s-]/g, "").trim()}.pdf`;
