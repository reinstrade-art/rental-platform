import "server-only";
import { newDocument, drawRail, drawRule, money, textRow, paletteFor } from "./pdf-chrome";
import type { OrgBranding } from "./pdf-chrome";
import { CHARGE_TYPE_LABEL } from "./constants";

export type InvoiceInput = {
  org: OrgBranding;
  period: Date; // month
  tenant: { name: string };
  unit: { label: string };
  property: { name: string };
  charges: { type: string; description: string | null; amount: number }[];
};

export async function buildInvoicePdf(input: InvoiceInput): Promise<Uint8Array> {
  const { doc, page, font, bold } = await newDocument();
  const palette = paletteFor(input.org.brandColor);
  const { bodyX, bodyY } = drawRail(page, font, bold, input.org, "Invoice");
  let y = bodyY;

  const periodLabel = new Date(input.period).toLocaleDateString(undefined, { year: "numeric", month: "long" });
  textRow(page, y, [{ text: `Billing period: ${periodLabel}`, x: bodyX, font, size: 10, color: palette.muted }]);
  y -= 30;

  textRow(page, y, [{ text: input.tenant.name, x: bodyX, font: bold, size: 14 }]);
  y -= 16;
  textRow(page, y, [
    { text: `${input.property.name} / ${input.unit.label}`, x: bodyX, font, size: 10, color: palette.muted },
  ]);
  y -= 30;
  drawRule(page, y, bodyX);
  y -= 20;

  textRow(page, y, [
    { text: "Item", x: bodyX, font, size: 9, color: palette.muted },
    { text: "Amount", x: 470, font, size: 9, color: palette.muted },
  ]);
  y -= 16;

  let total = 0;
  for (const charge of input.charges) {
    const label = CHARGE_TYPE_LABEL[charge.type] ?? charge.type;
    const text = charge.description ? `${label} — ${charge.description}` : label;
    textRow(page, y, [
      { text, x: bodyX, font, size: 10 },
      { text: money(charge.amount), x: 470, font, size: 10 },
    ]);
    total += charge.amount;
    y -= 18;
  }
  if (input.charges.length === 0) {
    textRow(page, y, [{ text: "No charges for this period.", x: bodyX, font, size: 10, color: palette.muted }]);
    y -= 18;
  }

  y -= 10;
  drawRule(page, y, bodyX);
  y -= 24;

  textRow(page, y, [
    { text: "Total due", x: bodyX, font: bold, size: 13 },
    { text: money(total), x: 470, font: bold, size: 13 },
  ]);

  page.drawText("This invoice was generated automatically and is valid without a signature.", {
    x: bodyX,
    y: 40,
    size: 8,
    font,
    color: palette.muted,
  });

  return doc.save();
}
