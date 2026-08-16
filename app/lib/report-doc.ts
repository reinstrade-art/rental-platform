import "server-only";
import { newDocument, drawHeader, drawRule, money, textRow, paletteFor, MARGIN, PAGE_WIDTH, PAGE_HEIGHT } from "./pdf-chrome";
import type { OrgBranding } from "./pdf-chrome";
import type { ReportData } from "./reports";

export async function buildReportPdf(org: OrgBranding, data: ReportData): Promise<Uint8Array> {
  const { doc, page, font, bold } = await newDocument();
  const palette = paletteFor(org.brandColor);
  let currentPage = page;
  let y = drawHeader(currentPage, font, bold, org, "Performance Report");

  y -= 10;
  textRow(currentPage, y, [
    { text: `${data.periodLabel}${data.propertyName ? ` · ${data.propertyName}` : " · Whole portfolio"}`, x: MARGIN, font, size: 10, color: palette.muted },
  ]);
  y -= 30;

  const newPageIfNeeded = (needed: number) => {
    if (y - needed > 50) return;
    currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  };

  // --- headline figures -------------------------------------------------
  const stats: [string, string][] = [
    ["YTD income", money(data.ytdIncome)],
    ["Net arrears (YTD)", money(data.ytdNetArrears)],
    ["Total shortfall", money(data.totalShortfall)],
    ["Collection rate", `${data.gauges.collectionRate}%`],
    ["Occupancy", `${data.gauges.occupancy}% (${data.gauges.occupiedUnits}/${data.gauges.totalUnits} units)`],
    ["Expenses (YTD)", money(data.expensesTotal)],
    ["Net cash (income - expenses)", money(data.netCash)],
  ];
  textRow(currentPage, y, [{ text: "Headline figures", x: MARGIN, font: bold, size: 12 }]);
  y -= 18;
  drawRule(currentPage, y);
  y -= 16;
  for (const [label, value] of stats) {
    textRow(currentPage, y, [
      { text: label, x: MARGIN, font, size: 9.5, color: palette.muted },
      { text: value, x: 300, font: bold, size: 9.5 },
    ]);
    y -= 15;
  }
  y -= 16;

  // --- income by month ----------------------------------------------------
  newPageIfNeeded(40 + data.incomeByMonth.length * 14);
  textRow(currentPage, y, [{ text: "Income by month", x: MARGIN, font: bold, size: 12 }]);
  y -= 18;
  drawRule(currentPage, y);
  y -= 16;
  for (const m of data.incomeByMonth) {
    newPageIfNeeded(14);
    textRow(currentPage, y, [
      { text: m.name, x: MARGIN, font, size: 9 },
      { text: money(m.value), x: 300, font, size: 9 },
    ]);
    y -= 14;
  }
  y -= 16;

  // --- worst / best payers -------------------------------------------------
  const payerTable = (title: string, rows: ReportData["worstPayers"]) => {
    newPageIfNeeded(40 + rows.length * 14);
    textRow(currentPage, y, [{ text: title, x: MARGIN, font: bold, size: 12 }]);
    y -= 18;
    drawRule(currentPage, y);
    y -= 14;
    textRow(currentPage, y, [
      { text: "Tenant", x: MARGIN, font: bold, size: 8, color: palette.muted },
      { text: "Unit", x: 220, font: bold, size: 8, color: palette.muted },
      { text: "Balance", x: 350, font: bold, size: 8, color: palette.muted },
      { text: "Consistency", x: 450, font: bold, size: 8, color: palette.muted },
    ]);
    y -= 14;
    if (rows.length === 0) {
      textRow(currentPage, y, [{ text: "None.", x: MARGIN, font, size: 9, color: palette.muted }]);
      y -= 14;
    }
    for (const r of rows) {
      newPageIfNeeded(14);
      textRow(currentPage, y, [
        { text: r.tenant, x: MARGIN, font, size: 9 },
        { text: `${r.property} / ${r.unit}`, x: 220, font, size: 9, color: palette.muted },
        { text: money(r.arrears), x: 350, font, size: 9, color: r.arrears < 0 ? palette.ink : palette.accent },
        { text: `${r.consistency}%`, x: 450, font, size: 9 },
      ]);
      y -= 14;
    }
    y -= 16;
  };

  payerTable("Worst payers", data.worstPayers);
  payerTable("Best payers", data.bestPayers);

  return doc.save();
}
