import "server-only";
import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont, RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "fs/promises";
import { join } from "path";

// A4. Page geometry only — nothing here names any particular business; every
// visible label comes from OrgBranding, which is data one org entered about
// itself, never a default baked into the template.
export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;
export const MARGIN = 48;

const DEFAULT_BRAND_HEX = "#1E3350"; // neutral slate, used until an org sets its own color

function hexToRgb(hex: string | null | undefined): RGB {
  const clean = (hex ?? DEFAULT_BRAND_HEX).replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const n = parseInt(full, 16);
  if (isNaN(n) || full.length !== 6) return hexToRgb(DEFAULT_BRAND_HEX);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Relative luminance decides whether text on the brand color should be black or white. */
function readableOn(bg: RGB): RGB {
  const luminance = 0.299 * bg.red + 0.587 * bg.green + 0.114 * bg.blue;
  return luminance > 0.6 ? rgb(0.1, 0.1, 0.12) : rgb(1, 1, 1);
}

export type Palette = {
  ink: RGB;
  muted: RGB;
  band: RGB;
  bandText: RGB;
  rule: RGB;
  accent: RGB;
};

/** Every color on the page is derived from one org-chosen brand color, so the same template reads as a different business for each customer. */
export function paletteFor(brandColorHex: string | null | undefined): Palette {
  const band = hexToRgb(brandColorHex);
  return {
    ink: rgb(0.11, 0.13, 0.18),
    muted: rgb(0.45, 0.47, 0.52),
    band,
    bandText: readableOn(band),
    rule: rgb(0.85, 0.86, 0.89),
    accent: band,
  };
}

export type OrgBranding = {
  name: string;
  letterheadName: string | null;
  letterheadAddress: string | null;
  letterheadPhone: string | null;
  letterheadEmail: string | null;
  brandColor: string | null;
};

export async function newDocument() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, page, font, bold };
}

/**
 * A genuine script face, embedded lazily — most documents never draw a
 * signature, so this cost is paid only by the ones that do. Allura, SIL
 * Open Font License 1.1 (Google Fonts), free to embed.
 */
let cursiveBytes: Buffer | null = null;
export async function embedCursive(doc: PDFDocument): Promise<PDFFont | null> {
  try {
    if (!cursiveBytes) {
      cursiveBytes = await readFile(join(process.cwd(), "app", "lib", "fonts", "Allura-Regular.ttf"));
    }
    doc.registerFontkit(fontkit);
    return await doc.embedFont(cursiveBytes);
  } catch {
    return null; // font missing — callers fall back to no signature drawn
  }
}

function orgLines(org: OrgBranding): string[] {
  const name = org.letterheadName || org.name;
  return [name, org.letterheadAddress, org.letterheadPhone, org.letterheadEmail].filter(
    (l): l is string => Boolean(l),
  );
}

/**
 * Horizontal band across the top — used for receipts. Deliberately laid out
 * differently from drawRail() so the two document types are never confused
 * at a glance, even printed side by side.
 */
export function drawHeader(page: PDFPage, font: PDFFont, bold: PDFFont, org: OrgBranding, title: string) {
  const p = paletteFor(org.brandColor);
  const bandHeight = 90;
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - bandHeight, width: PAGE_WIDTH, height: bandHeight, color: p.band });

  const lines = orgLines(org);
  page.drawText(lines[0] ?? org.name, {
    x: MARGIN,
    y: PAGE_HEIGHT - 38,
    size: 16,
    font: bold,
    color: p.bandText,
  });
  page.drawText(lines.slice(1).join("  ·  "), {
    x: MARGIN,
    y: PAGE_HEIGHT - 56,
    size: 9,
    font,
    color: p.bandText,
  });

  page.drawText(title.toUpperCase(), {
    x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize(title.toUpperCase(), 20),
    y: PAGE_HEIGHT - 46,
    size: 20,
    font: bold,
    color: p.bandText,
  });

  return PAGE_HEIGHT - bandHeight - 36; // y cursor for body content
}

/**
 * Vertical left band — used for invoices. See drawHeader() for why the two
 * layouts are deliberately different rather than sharing one template.
 */
export function drawRail(page: PDFPage, font: PDFFont, bold: PDFFont, org: OrgBranding, title: string) {
  const p = paletteFor(org.brandColor);
  const railWidth = 150;
  page.drawRectangle({ x: 0, y: 0, width: railWidth, height: PAGE_HEIGHT, color: p.band });

  const lines = orgLines(org);
  let y = PAGE_HEIGHT - 60;
  page.drawText(lines[0] ?? org.name, { x: 16, y, size: 13, font: bold, color: p.bandText, maxWidth: railWidth - 24 });
  y -= 22;
  for (const line of lines.slice(1)) {
    page.drawText(line, { x: 16, y, size: 8, font, color: p.bandText, maxWidth: railWidth - 24 });
    y -= 14;
  }

  page.drawText(title.toUpperCase(), { x: railWidth + MARGIN, y: PAGE_HEIGHT - 60, size: 22, font: bold, color: p.ink });

  return { bodyX: railWidth + MARGIN, bodyY: PAGE_HEIGHT - 100 };
}

export function drawRule(page: PDFPage, y: number, x0 = MARGIN, x1 = PAGE_WIDTH - MARGIN) {
  page.drawLine({ start: { x: x0, y }, end: { x: x1, y }, thickness: 0.75, color: rgb(0.85, 0.86, 0.89) });
}

export function money(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function textRow(
  page: PDFPage,
  y: number,
  cells: { text: string; x: number; font: PDFFont; size?: number; color?: RGB }[],
) {
  for (const c of cells) {
    page.drawText(c.text, { x: c.x, y, size: c.size ?? 10, font: c.font, color: c.color ?? rgb(0.11, 0.13, 0.18) });
  }
}
