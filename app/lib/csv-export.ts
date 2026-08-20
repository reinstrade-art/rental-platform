import "server-only";

/** Quotes a field only when it needs it — commas, quotes, or newlines — doubling any embedded quotes. */
function csvField(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(csvField).join(",")];
  for (const row of rows) lines.push(row.map(csvField).join(","));
  // \r\n and a leading BOM — Excel on Windows otherwise mis-detects the
  // encoding and garbles anything outside plain ASCII in the first cell.
  return "﻿" + lines.join("\r\n");
}

export function csvResponseHeaders(filename: string): HeadersInit {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
  };
}
