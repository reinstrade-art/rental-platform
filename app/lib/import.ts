import "server-only";
import { prisma } from "./prisma";

// Shared CSV plumbing for every bulk importer below. Handles quoted fields
// (so amounts like `" 4,000 "` survive) since the naive `split(",")` used by
// the payments importer breaks on exactly that shape.
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function splitCsvRows(csv: string): string[][] {
  // Excel (and Windows generally) commonly saves CSV as UTF-8 with a leading
  // byte-order-mark — invisible in a text editor, but it silently glues
  // itself onto the first header cell ("﻿Unit #" ≠ "Unit #"), so only
  // the FIRST column's header ever failed to match, which read as a
  // confusing "no valid rows" on files that otherwise looked completely fine.
  if (csv.charCodeAt(0) === 0xfeff) csv = csv.slice(1);
  return csv
    .split(/\r?\n/)
    .filter((r) => r.trim().length > 0)
    .map(parseCsvLine);
}

/** Turns "4,000", " 4,000 ", "-", "" into a number — the shapes a hand-kept rent-roll spreadsheet actually uses. */
function money(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
}

function headerIndex(header: string[], ...names: string[]): number {
  const lower = header.map((h) => h.toLowerCase().trim());
  for (const name of names) {
    const idx = lower.indexOf(name.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

// --- properties -------------------------------------------------------

export type PropertyRow = { name: string; address: string | null };

/** One row per property: name,address — header row optional. */
export function parsePropertiesCsv(csv: string): PropertyRow[] {
  const out: PropertyRow[] = [];
  for (const [name, address] of splitCsvRows(csv)) {
    if (!name || name.toLowerCase() === "name") continue;
    out.push({ name, address: address || null });
  }
  return out;
}

// --- tenants ------------------------------------------------------------

export type TenantRow = { name: string; phone: string | null; email: string | null };

/** One row per tenant: name,phone,email — header row optional. */
export function parseTenantsCsv(csv: string): TenantRow[] {
  const out: TenantRow[] = [];
  for (const [name, phone, email] of splitCsvRows(csv)) {
    if (!name || name.toLowerCase() === "name") continue;
    out.push({ name, phone: phone || null, email: email || null });
  }
  return out;
}

// --- rent roll (properties + units + tenants + leases + charges + payments) --

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

export type RentRollRow = {
  unitLabel: string;
  tenantName: string | null; // null = vacant, no tenant/lease created for the row
  periodMonth: Date; // UTC month-start
  expectedRent: number;
  billedRent: number;
  rentPaid: number;
  // A one-off deposit HELD, not billed every period — see ingestRentRoll,
  // which raises this at most once per lease regardless of how many rows
  // (months) that lease appears in across the file.
  deposit: number;
  // A recurring per-period charge distinct from rent — billed every period
  // it appears in, same as rent, but as its own HYGIENE line (garbage /
  // waste collection) so it reads separately on a statement.
  utilityFee: number;
  // Same idea, for a separate water-bill column when the spreadsheet has one.
  waterFee: number;
};

/**
 * Parses the "rent roll" shape a landlord's own spreadsheet already uses —
 * one row per unit per month: Unit #, Tenant, Month, Year, Expected Rent,
 * Billed Rent, RENT Paid, plus two optional columns — a deposit column
 * (Deposit / Rent Deposit Payment / ...) and a utility/service-fee column
 * (Garbage Collection Fees / Utility / Service Charge / ...) — neither of
 * which every spreadsheet has, so both simply read as 0 when absent.
 * Arrears/Resultant Balance are derivable and ignored on import. Column
 * order is read from the header row by name, not position, so a
 * spreadsheet's own column order doesn't need to change.
 */
export function parseRentRollCsv(csv: string): RentRollRow[] {
  const rows = splitCsvRows(csv);
  if (rows.length < 2) return [];

  // Some spreadsheets lead with a title row (e.g. "Alma Hill Apartment,,,,")
  // before the real header — scanned for among the first few lines rather
  // than assumed to always be row one, so a title row doesn't read as an
  // unrecognisable header and fail the whole import.
  let headerRowIdx = -1;
  let unitIdx = -1;
  let tenantIdx = -1;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const candidate = rows[i];
    const u = headerIndex(candidate, "unit #", "unit", "unit number", "unit label");
    const t = headerIndex(candidate, "tenant", "tenant name", "name of tenant");
    if (u !== -1 && t !== -1) {
      headerRowIdx = i;
      unitIdx = u;
      tenantIdx = t;
      break;
    }
  }
  if (headerRowIdx === -1) return [];
  const header = rows[headerRowIdx];

  const monthIdx = headerIndex(header, "month");
  const yearIdx = headerIndex(header, "year");
  const expectedIdx = headerIndex(header, "expected rent", "monthly rent", "rent", "rent expected");
  const billedIdx = headerIndex(header, "billed rent");
  const paidIdx = headerIndex(header, "rent paid", "paid", "rent received");
  const depositIdx = headerIndex(header, "deposit", "rent deposit payment", "deposit paid", "deposit amount", "deposit held");
  const utilityIdx = headerIndex(
    header,
    "garbage collection fees",
    "garbage",
    "garbage fees",
    "garbage collection",
    "hygiene",
    "hygiene services",
    "utility",
    "utilities",
    "utility fee",
    "service charge",
  );
  const waterIdx = headerIndex(header, "water", "water bill", "water bills", "water services", "water fee");

  const now = new Date();
  const out: RentRollRow[] = [];
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const cols = rows[i];
    const unitLabel = cols[unitIdx];
    if (!unitLabel) continue;

    const tenantRaw = (cols[tenantIdx] ?? "").replace(/\s+/g, " ").trim();
    const tenantName = tenantRaw && !/^vacant$/i.test(tenantRaw) ? tenantRaw : null;

    const monthName = monthIdx !== -1 ? cols[monthIdx]?.toLowerCase() : "";
    const monthNum = monthName && monthName in MONTHS ? MONTHS[monthName] : now.getUTCMonth();
    const year = yearIdx !== -1 ? Number(cols[yearIdx]) || now.getUTCFullYear() : now.getUTCFullYear();

    out.push({
      unitLabel,
      tenantName,
      periodMonth: new Date(Date.UTC(year, monthNum, 1)),
      expectedRent: expectedIdx !== -1 ? money(cols[expectedIdx]) : 0,
      billedRent: billedIdx !== -1 ? money(cols[billedIdx]) : 0,
      rentPaid: paidIdx !== -1 ? money(cols[paidIdx]) : 0,
      deposit: depositIdx !== -1 ? money(cols[depositIdx]) : 0,
      utilityFee: utilityIdx !== -1 ? money(cols[utilityIdx]) : 0,
      waterFee: waterIdx !== -1 ? money(cols[waterIdx]) : 0,
    });
  }
  return out;
}

export type RentRollSummary = { units: number; tenants: number; leases: number; charges: number; payments: number };

/**
 * Applies parsed rent-roll rows to one property: creates/updates each Unit,
 * finds-or-creates each Tenant by name, finds-or-creates the Unit+Tenant
 * Lease, and records the period's Charge/Payment if not already on file —
 * so re-importing the same file (e.g. an updated month) never double-counts
 * a charge or payment already recorded for that lease and period.
 */
export async function ingestRentRoll(
  organizationId: string,
  propertyId: string,
  rows: RentRollRow[],
): Promise<RentRollSummary> {
  const summary: RentRollSummary = { units: 0, tenants: 0, leases: 0, charges: 0, payments: 0 };

  const tenants = await prisma.tenant.findMany({ where: { organizationId } });
  const tenantByName = new Map(tenants.map((t) => [t.name.trim().toLowerCase(), t]));

  for (const row of rows) {
    const unit = await prisma.unit.upsert({
      where: { propertyId_label: { propertyId, label: row.unitLabel } },
      update: row.expectedRent ? { monthlyRent: row.expectedRent } : {},
      create: { organizationId, propertyId, label: row.unitLabel, monthlyRent: row.expectedRent || null },
    });
    summary.units++;

    if (!row.tenantName) continue;

    const key = row.tenantName.toLowerCase();
    let tenant = tenantByName.get(key);
    if (!tenant) {
      tenant = await prisma.tenant.create({ data: { organizationId, name: row.tenantName } });
      tenantByName.set(key, tenant);
      summary.tenants++;
    }

    let lease = await prisma.lease.findFirst({
      where: { organizationId, unitId: unit.id, tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
    });
    if (!lease) {
      lease = await prisma.lease.create({
        data: {
          organizationId,
          unitId: unit.id,
          tenantId: tenant.id,
          monthlyRent: row.expectedRent || 0,
          startDate: row.periodMonth,
          status: "ACTIVE",
        },
      });
      summary.leases++;
    }

    const billed = row.billedRent || row.expectedRent;
    if (billed) {
      const existingCharge = await prisma.charge.findFirst({
        where: { leaseId: lease.id, periodMonth: row.periodMonth, type: "RENT" },
      });
      if (!existingCharge) {
        await prisma.charge.create({
          data: { organizationId, leaseId: lease.id, type: "RENT", amount: billed, periodMonth: row.periodMonth },
        });
        summary.charges++;
      }
    }

    if (row.rentPaid) {
      const existingPayment = await prisma.payment.findFirst({
        where: { leaseId: lease.id, amount: row.rentPaid, paidAt: row.periodMonth },
      });
      if (!existingPayment) {
        await prisma.payment.create({
          data: { organizationId, leaseId: lease.id, amount: row.rentPaid, method: "IMPORT", paidAt: row.periodMonth },
        });
        summary.payments++;
      }
    }

    // A deposit is held once, not billed every month a lease shows up in the
    // file — so it's raised only the first time this lease is seen with one,
    // never re-raised on a later row (a later month re-import, or a second
    // row for the same lease). A "deposit payment" column is read as already
    // received, so the matching payment is recorded alongside it.
    if (row.deposit) {
      const existingDeposit = await prisma.charge.findFirst({ where: { leaseId: lease.id, type: "DEPOSIT" } });
      if (!existingDeposit) {
        await prisma.charge.create({
          data: { organizationId, leaseId: lease.id, type: "DEPOSIT", amount: row.deposit, periodMonth: row.periodMonth },
        });
        summary.charges++;
        await prisma.payment.create({
          data: { organizationId, leaseId: lease.id, amount: row.deposit, method: "IMPORT", paidAt: row.periodMonth },
        });
        summary.payments++;
      }
    }

    // A recurring charge distinct from rent (garbage collection, a hygiene
    // fee, ...) — billed per period exactly like rent, as its own HYGIENE
    // line, with the same re-run safety: never raised twice for one lease
    // and period.
    if (row.utilityFee) {
      const existingHygiene = await prisma.charge.findFirst({
        where: { leaseId: lease.id, periodMonth: row.periodMonth, type: "HYGIENE" },
      });
      if (!existingHygiene) {
        await prisma.charge.create({
          data: { organizationId, leaseId: lease.id, type: "HYGIENE", amount: row.utilityFee, periodMonth: row.periodMonth },
        });
        summary.charges++;
      }
    }

    // Same idea for a separate water-bill column, as its own WATER line.
    if (row.waterFee) {
      const existingWater = await prisma.charge.findFirst({
        where: { leaseId: lease.id, periodMonth: row.periodMonth, type: "WATER" },
      });
      if (!existingWater) {
        await prisma.charge.create({
          data: { organizationId, leaseId: lease.id, type: "WATER", amount: row.waterFee, periodMonth: row.periodMonth },
        });
        summary.charges++;
      }
    }
  }

  return summary;
}
