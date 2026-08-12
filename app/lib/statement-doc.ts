import "server-only";
import { newDocument, drawHeader, drawRule, money, textRow, paletteFor, MARGIN, PAGE_WIDTH, PAGE_HEIGHT } from "./pdf-chrome";
import type { OrgBranding } from "./pdf-chrome";
import { buildStatement } from "./statement";

export type StatementInput = {
  org: OrgBranding;
  tenant: { name: string };
  unit: { label: string };
  property: { name: string };
  charges: { id: string; type: string; description: string | null; amount: number; periodMonth: Date }[];
  payments: { id: string; amount: number; method: string | null; reference: string | null; paidAt: Date }[];
};

export async function buildStatementPdf(input: StatementInput): Promise<Uint8Array> {
  const { doc, page, font, bold } = await newDocument();
  const palette = paletteFor(input.org.brandColor);
  let currentPage = page;
  let y = drawHeader(currentPage, font, bold, input.org, "Statement");

  y -= 10;
  textRow(currentPage, y, [{ text: input.tenant.name, x: MARGIN, font: bold, size: 13 }]);
  y -= 16;
  textRow(currentPage, y, [
    { text: `${input.property.name} / ${input.unit.label}`, x: MARGIN, font, size: 10, color: palette.muted },
  ]);
  y -= 28;

  const months = buildStatement(input.charges, input.payments);

  const newPageIfNeeded = async (needed: number) => {
    if (y - needed > 50) return;
    currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
    textRow(currentPage, y, [{ text: `${input.tenant.name} — statement (continued)`, x: MARGIN, font, size: 9, color: palette.muted }]);
    y -= 24;
  };

  for (const month of months) {
    await newPageIfNeeded(30 + month.lines.length * 16 + 30);

    textRow(currentPage, y, [{ text: month.title, x: MARGIN, font: bold, size: 11 }]);
    y -= 16;
    drawRule(currentPage, y);
    y -= 14;

    for (const line of month.lines) {
      await newPageIfNeeded(20);
      const debit = line.debit > 0 ? money(line.debit) : "";
      const credit = line.credit > 0 ? money(line.credit) : "";
      textRow(currentPage, y, [
        { text: line.desc, x: MARGIN, font, size: 9 },
        { text: debit, x: 350, font, size: 9 },
        { text: credit, x: 440, font, size: 9, color: palette.accent },
      ]);
      y -= 14;
    }

    y -= 4;
    textRow(currentPage, y, [
      { text: "Balance carried forward", x: MARGIN, font, size: 9, color: palette.muted },
      {
        text: money(Math.abs(month.closing)),
        x: 440,
        font: bold,
        size: 10,
        color: month.closing < 0 ? palette.ink : palette.accent,
      },
    ]);
    y -= 26;
  }

  if (months.length === 0) {
    textRow(currentPage, y, [{ text: "No activity on this tenancy yet.", x: MARGIN, font, size: 10, color: palette.muted }]);
  }

  return doc.save();
}
