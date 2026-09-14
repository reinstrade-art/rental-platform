import "server-only";
import { prisma } from "./prisma";
import { mpesaConfigured } from "./mpesa";

/**
 * The two ways a tenant can pay one lease, resolved together so the portal
 * and the office pages present a single "here's how to pay" panel instead of
 * an STK button in one place and a silently-reconciled paybill in another.
 *
 *  - STK Push: the app raises the prompt and matches the callback by an id
 *    it generated (see mpesa.ts / mpesa-actions.ts).
 *  - Direct paybill/till: the tenant pays from the M-Pesa menu; the C2B
 *    webhook auto-matches it by the unit's payment code (see payments.ts
 *    tryAutoMatch). A Till (Buy Goods) carries no account number, so that
 *    route can't self-reconcile — the panel says so rather than implying it.
 *
 * Same lease, same ledger, whichever route the money takes.
 */
export type MpesaPayOptions = {
  /** STK Push is fully configured for this org (full Daraja credentials). */
  stkReady: boolean;
  accountType: "PAYBILL" | "TILL";
  shortcode: string | null;
  /** What the tenant types as the M-Pesa account number for a direct paybill payment — the unit's payment code. Null for a Till. */
  accountRef: string | null;
  /** A direct menu payment is possible (a shortcode exists, plus an account code when it's a paybill). */
  directReady: boolean;
  /** A direct paybill payment will reconcile itself (full credentials present, so the C2B webhook can be registered). */
  directAutoMatch: boolean;
};

/**
 * A stable, human-keyable account code for a unit, derived from its label —
 * uppercased, alphanumerics only. Guarantees per-org uniqueness AND that no
 * code is a substring of another (the C2B matcher does an `includes` test,
 * so "A1" inside "A12" would double-match), appending a digit until both
 * hold. Idempotent: returns the existing code untouched if there is one.
 */
export async function ensureUnitPaymentCode(unitId: string): Promise<string | null> {
  const unit = await prisma.unit.findUnique({
    where: { id: unitId },
    select: { id: true, label: true, organizationId: true, paymentCode: true },
  });
  if (!unit) return null;
  if (unit.paymentCode) return unit.paymentCode;

  const base = (unit.label || "UNIT").toUpperCase().replace(/[^A-Z0-9]/g, "") || "UNIT";
  const taken = (
    await prisma.unit.findMany({
      where: { organizationId: unit.organizationId, paymentCode: { not: null } },
      select: { paymentCode: true },
    })
  ).map((u) => u.paymentCode!.toUpperCase());

  const clashes = (code: string) => taken.some((t) => t === code || t.includes(code) || code.includes(t));

  let candidate = base;
  let n = 1;
  while (clashes(candidate)) candidate = `${base}${++n}`;

  try {
    await prisma.unit.update({ where: { id: unit.id }, data: { paymentCode: candidate } });
    return candidate;
  } catch {
    // Lost a race on @@unique([organizationId, paymentCode]) — re-read.
    const fresh = await prisma.unit.findUnique({ where: { id: unit.id }, select: { paymentCode: true } });
    return fresh?.paymentCode ?? null;
  }
}

/** Backfills a payment code onto every unit in the org that lacks one. Returns how many were assigned. */
export async function ensureOrgPaymentCodes(organizationId: string): Promise<number> {
  const units = await prisma.unit.findMany({ where: { organizationId, paymentCode: null }, select: { id: true } });
  let assigned = 0;
  for (const u of units) {
    if (await ensureUnitPaymentCode(u.id)) assigned++;
  }
  return assigned;
}

export async function mpesaPayOptionsForLease(organizationId: string, leaseId: string): Promise<MpesaPayOptions> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: {
      mpesaEnv: true,
      mpesaShortcode: true,
      mpesaAccountType: true,
      mpesaConsumerKey: true,
      mpesaConsumerSecret: true,
      mpesaPasskey: true,
    },
  });

  const stkReady = mpesaConfigured({
    env: org.mpesaEnv,
    shortcode: org.mpesaShortcode,
    accountType: org.mpesaAccountType,
    consumerKey: org.mpesaConsumerKey,
    consumerSecret: org.mpesaConsumerSecret,
    passkey: org.mpesaPasskey,
  });
  const accountType: "PAYBILL" | "TILL" = org.mpesaAccountType === "TILL" ? "TILL" : "PAYBILL";

  let accountRef: string | null = null;
  if (accountType === "PAYBILL" && org.mpesaShortcode) {
    const lease = await prisma.lease.findFirst({ where: { id: leaseId, organizationId }, select: { unitId: true } });
    if (lease) accountRef = await ensureUnitPaymentCode(lease.unitId);
  }

  return {
    stkReady,
    accountType,
    shortcode: org.mpesaShortcode,
    accountRef,
    directReady: Boolean(org.mpesaShortcode) && (accountType === "TILL" || Boolean(accountRef)),
    directAutoMatch: stkReady && accountType === "PAYBILL" && Boolean(accountRef),
  };
}
