import "server-only";
import { newDocument, drawHeader, drawRule, money, textRow, paletteFor, MARGIN } from "./pdf-chrome";
import type { OrgBranding } from "./pdf-chrome";
import { CHARGE_TYPE_LABEL } from "./constants";

const PAGE_RIGHT_LABEL_X = 460;

export type ReceiptInput = {
  org: OrgBranding;
  payment: { id: string; amount: number; method: string | null; reference: string | null; paidAt: Date };
  tenant: { name: string };
  unit: { label: string };
  property: { name: string };
  balanceAfter: number;
  /** What this tenancy was billed for the same month as this payment — shown as an itemized
   *  reference, not a claim about which part of the payment covered which line (see settle.ts).
   *  Only used when this payment carries no directed allocations of its own. */
  periodCharges: { type: string; description: string | null; amount: number }[];
  /** How the office actually itemized THIS payment — "4,000 of this is rent, 200 is water".
   *  A statement of fact recorded at the time, unlike periodCharges above. */
  allocations: { amount: number; charge: { type: string; description: string | null } }[];
};

export async function buildReceiptPdf(input: ReceiptInput): Promise<Uint8Array> {
  const { doc, page, font, bold } = await newDocument();
  const palette = paletteFor(input.org.brandColor);
  let y = drawHeader(page, font, bold, input.org, "Receipt");

  y -= 10;
  textRow(page, y, [{ text: `Receipt #${input.payment.id.slice(-8).toUpperCase()}`, x: MARGIN, font: bold, size: 11 }]);
  textRow(page, y, [
    {
      text: new Date(input.payment.paidAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }),
      x: 350,
      font,
      size: 10,
      color: palette.muted,
    },
  ]);
  y -= 26;
  drawRule(page, y);
  y -= 24;

  textRow(page, y, [
    { text: "Received from", x: MARGIN, font, size: 9, color: palette.muted },
  ]);
  y -= 16;
  textRow(page, y, [
    { text: input.tenant.name, x: MARGIN, font: bold, size: 13 },
  ]);
  y -= 16;
  textRow(page, y, [
    { text: `${input.property.name} / ${input.unit.label}`, x: MARGIN, font, size: 10, color: palette.muted },
  ]);

  y -= 40;
  drawRule(page, y);
  y -= 24;

  if (input.allocations.length > 0) {
    // The office itemized this specific payment — a fact, not a derived guess.
    textRow(page, y, [{ text: "This payment covers", x: MARGIN, font, size: 9, color: palette.muted }]);
    y -= 16;
    let allocated = 0;
    for (const a of input.allocations) {
      const label = a.charge.description || CHARGE_TYPE_LABEL[a.charge.type] || a.charge.type;
      textRow(page, y, [
        { text: label, x: MARGIN, font, size: 10 },
        { text: money(a.amount), x: PAGE_RIGHT_LABEL_X, font, size: 10 },
      ]);
      allocated += a.amount;
      y -= 15;
    }
    const unallocated = Math.round((input.payment.amount - allocated) * 100) / 100;
    if (unallocated > 0.005) {
      textRow(page, y, [
        { text: "Unallocated (applied to oldest balance)", x: MARGIN, font, size: 10, color: palette.muted },
        { text: money(unallocated), x: PAGE_RIGHT_LABEL_X, font, size: 10, color: palette.muted },
      ]);
      y -= 15;
    }
    y -= 11;
    drawRule(page, y);
    y -= 24;
  } else if (input.periodCharges.length > 0) {
    const periodLabel = new Date(input.payment.paidAt).toLocaleDateString(undefined, { year: "numeric", month: "long" });
    textRow(page, y, [{ text: `Billed for ${periodLabel}`, x: MARGIN, font, size: 9, color: palette.muted }]);
    y -= 16;
    let periodTotal = 0;
    for (const charge of input.periodCharges) {
      const label = charge.description || CHARGE_TYPE_LABEL[charge.type] || charge.type;
      textRow(page, y, [
        { text: label, x: MARGIN, font, size: 10 },
        { text: money(charge.amount), x: PAGE_RIGHT_LABEL_X, font, size: 10 },
      ]);
      periodTotal += charge.amount;
      y -= 15;
    }
    textRow(page, y, [
      { text: "Total billed", x: MARGIN, font: bold, size: 10 },
      { text: money(periodTotal), x: PAGE_RIGHT_LABEL_X, font: bold, size: 10 },
    ]);
    y -= 26;
    drawRule(page, y);
    y -= 24;
  }

  textRow(page, y, [
    { text: "Amount received", x: MARGIN, font, size: 10, color: palette.muted },
    { text: "Method", x: 300, font, size: 10, color: palette.muted },
    { text: "Reference", x: 420, font, size: 10, color: palette.muted },
  ]);
  y -= 18;
  textRow(page, y, [
    { text: money(input.payment.amount), x: MARGIN, font: bold, size: 14 },
    { text: input.payment.method ?? "—", x: 300, font, size: 11 },
    { text: input.payment.reference ?? "—", x: 420, font, size: 11 },
  ]);

  y -= 40;
  drawRule(page, y);
  y -= 24;

  const balanceLabel = input.balanceAfter > 0 ? "Balance owing after this payment" : "Balance after this payment";
  textRow(page, y, [
    { text: balanceLabel, x: MARGIN, font, size: 10, color: palette.muted },
    {
      text: money(Math.abs(input.balanceAfter)),
      x: PAGE_RIGHT_LABEL_X,
      font: bold,
      size: 12,
      color: input.balanceAfter > 0 ? palette.ink : palette.accent,
    },
  ]);

  page.drawText("This receipt was generated automatically and is valid without a signature.", {
    x: MARGIN,
    y: 40,
    size: 8,
    font,
    color: palette.muted,
  });

  return doc.save();
}
