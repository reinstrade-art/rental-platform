import "server-only";
import { prisma } from "./prisma";

const MPESA_SOURCES = new Set(["MPESA_DARAJA", "MPESA_STK"]);

export type IngestInput = {
  organizationId: string;
  source: "MANUAL" | "CSV_IMPORT" | "MPESA_DARAJA" | "MPESA_STK";
  amount: number;
  reference?: string | null;
  payerName?: string | null;
  occurredAt: Date;
  rawPayload?: unknown;
};

/**
 * The single entry point for money arriving from any source. Every ingestion
 * path — manual entry, CSV import, or a live paybill webhook — calls this
 * one function, so "how a Transaction becomes a Payment" is decided in
 * exactly one place regardless of where the money came from.
 *
 * Auto-match: the reference is checked (case-insensitively, substring match)
 * against every Unit.paymentCode in the organization. A match's ACTIVE lease
 * gets an immediate Payment. No match leaves the Transaction UNMATCHED for a
 * human to resolve — it is never guessed at or dropped silently.
 */
export async function ingestTransaction(input: IngestInput) {
  const transaction = await prisma.transaction.create({
    data: {
      organizationId: input.organizationId,
      source: input.source,
      amount: input.amount,
      reference: input.reference ?? null,
      payerName: input.payerName ?? null,
      occurredAt: input.occurredAt,
      rawPayload: input.rawPayload ? JSON.stringify(input.rawPayload) : null,
    },
  });

  const matched = await tryAutoMatch(transaction.id);
  return matched ?? transaction;
}

async function tryAutoMatch(transactionId: string) {
  const transaction = await prisma.transaction.findUniqueOrThrow({ where: { id: transactionId } });
  if (!transaction.reference) return null;

  const units = await prisma.unit.findMany({
    where: { organizationId: transaction.organizationId, paymentCode: { not: null } },
    select: { id: true, paymentCode: true },
  });
  const ref = transaction.reference.toUpperCase();
  const unit = units.find((u) => u.paymentCode && ref.includes(u.paymentCode.toUpperCase()));
  if (!unit) return null;

  const lease = await prisma.lease.findFirst({
    where: { unitId: unit.id, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });
  if (!lease) return null;

  return matchTransaction(transaction.organizationId, transactionId, lease.id, null);
}

/**
 * Turns an UNMATCHED transaction into a real Payment against the given
 * lease. `matchedBy` is the staff userId for a manual match, null for an
 * automatic one — so the ledger always shows which happened.
 */
export async function matchTransaction(
  organizationId: string,
  transactionId: string,
  leaseId: string,
  matchedBy: string | null,
) {
  const transaction = await prisma.transaction.findFirst({
    where: { id: transactionId, organizationId, status: "UNMATCHED" },
  });
  if (!transaction) throw new Error("Transaction not found or already resolved.");

  const lease = await prisma.lease.findFirst({ where: { id: leaseId, organizationId } });
  if (!lease) throw new Error("Lease not found.");

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        organizationId,
        leaseId,
        amount: transaction.amount,
        method: MPESA_SOURCES.has(transaction.source) ? "MPESA" : transaction.source,
        reference: transaction.reference,
        paidAt: transaction.occurredAt,
      },
    });
    return tx.transaction.update({
      where: { id: transactionId },
      data: { status: "MATCHED", matchedLeaseId: leaseId, matchedPaymentId: payment.id, matchedBy, matchedAt: new Date() },
    });
  });
}

export async function ignoreTransaction(organizationId: string, transactionId: string, staffUserId: string) {
  const transaction = await prisma.transaction.findFirst({
    where: { id: transactionId, organizationId, status: "UNMATCHED" },
  });
  if (!transaction) throw new Error("Transaction not found or already resolved.");

  await prisma.transaction.update({
    where: { id: transactionId },
    data: { status: "IGNORED", matchedBy: staffUserId, matchedAt: new Date() },
  });
}

/** Minimal CSV: date,amount,reference,payer — one transaction per row, header row optional. */
export function parseTransactionsCsv(csv: string): Omit<IngestInput, "organizationId" | "source">[] {
  const rows = csv
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter(Boolean);
  const out: Omit<IngestInput, "organizationId" | "source">[] = [];

  for (const row of rows) {
    const cols = row.split(",").map((c) => c.trim());
    const [dateStr, amountStr, reference, payer] = cols;
    const occurredAt = new Date(dateStr);
    const amount = Number(amountStr);
    if (isNaN(occurredAt.getTime()) || !amount) continue; // header row or malformed line — skipped, not fatal
    out.push({ occurredAt, amount, reference: reference || null, payerName: payer || null });
  }
  return out;
}
