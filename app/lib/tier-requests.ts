import "server-only";
import { prisma } from "./prisma";
import { stkPush } from "./mpesa";
import { ORG_TIERS, type OrgTier } from "./constants";
import { tierRank } from "./tier";
import { platformMpesaCredentials } from "./licensing";

export { platformMpesaConfigured } from "./licensing";

/**
 * Self-service package changes.
 *
 * A downgrade is free and takes effect immediately — there's nothing to
 * collect, so nothing to wait on. An upgrade needs money to change hands
 * first: either an M-Pesa STK Push the landlord pays themselves (confirmed
 * automatically by the callback, same discipline as license billing never
 * trusting the raise alone), or a manual method (bank/cash/other) that sits
 * PENDING until a platform admin confirms the money actually landed — the
 * same reasoning recordLicensePayment already applies, since nothing here
 * can verify a bank transfer or cash on its own.
 */

export async function getTierPrices(): Promise<Record<OrgTier, number | null>> {
  const rows = await prisma.tierPrice.findMany();
  const byTier = new Map(rows.map((r) => [r.tier, r.priceKes]));
  return Object.fromEntries(ORG_TIERS.map((t) => [t, byTier.get(t) ?? null])) as Record<OrgTier, number | null>;
}

export async function setTierPrice(tier: OrgTier, priceKes: number) {
  await prisma.tierPrice.upsert({
    where: { tier },
    create: { tier, priceKes },
    update: { priceKes },
  });
}

/** This org's negotiated prices, keyed by tier — only the tiers with an override present. */
export async function getOrgTierPrices(organizationId: string): Promise<Partial<Record<OrgTier, number>>> {
  const rows = await prisma.orgTierPrice.findMany({ where: { organizationId } });
  return Object.fromEntries(rows.map((r) => [r.tier, r.priceKes])) as Partial<Record<OrgTier, number>>;
}

export async function setOrgTierPrice(organizationId: string, tier: OrgTier, priceKes: number) {
  await prisma.orgTierPrice.upsert({
    where: { organizationId_tier: { organizationId, tier } },
    create: { organizationId, tier, priceKes },
    update: { priceKes },
  });
}

export async function clearOrgTierPrice(organizationId: string, tier: OrgTier) {
  await prisma.orgTierPrice.deleteMany({ where: { organizationId, tier } });
}

/** What this org actually pays to reach `tier` — their own negotiated price if one exists, else the standard list price. */
export async function getEffectiveTierPrice(organizationId: string, tier: OrgTier): Promise<number | null> {
  const override = await prisma.orgTierPrice.findUnique({ where: { organizationId_tier: { organizationId, tier } } });
  if (override) return override.priceKes;
  const row = await prisma.tierPrice.findUnique({ where: { tier } });
  return row?.priceKes ?? null;
}

/** Applies a downgrade immediately — no payment, no confirmation step. Still logged for a complete history. */
export async function downgradeTier(organizationId: string, toTier: OrgTier, requestedBy: string) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  if (tierRank(toTier) >= tierRank(org.tier)) {
    throw new Error("That isn't a downgrade from your current package.");
  }

  await prisma.$transaction([
    prisma.tierChangeRequest.create({
      data: {
        organizationId,
        fromTier: org.tier,
        toTier,
        amount: 0,
        method: "DOWNGRADE",
        status: "SUCCESS",
        requestedBy,
        confirmedAt: new Date(),
      },
    }),
    prisma.organization.update({ where: { id: organizationId }, data: { tier: toTier } }),
  ]);
}

/** Raises an STK Push against the platform's own shortcode for an upgrade. PENDING until the callback confirms it. */
export async function sendTierUpgradeStk(
  organizationId: string,
  toTier: OrgTier,
  phone: string,
  amount: number,
  requestedBy: string,
  callbackUrl: string,
) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  if (tierRank(toTier) <= tierRank(org.tier)) {
    throw new Error("That isn't an upgrade from your current package.");
  }

  const result = await stkPush(platformMpesaCredentials(), {
    phone,
    amount,
    accountReference: org.name,
    description: `Upgrade to ${toTier}`,
    callbackUrl,
  });
  if (!result.ok) return { ok: false as const, reason: result.reason };

  await prisma.tierChangeRequest.create({
    data: {
      organizationId,
      fromTier: org.tier,
      toTier,
      amount: Math.round(amount),
      method: "MPESA_STK",
      status: "PENDING",
      merchantRequestId: result.merchantRequestId,
      checkoutRequestId: result.checkoutRequestId,
      requestedBy,
    },
  });
  return { ok: true as const };
}

/** Records an upgrade request paid by a method this app can't verify itself — sits PENDING for a platform admin. */
export async function requestTierChangeManual(
  organizationId: string,
  toTier: OrgTier,
  amount: number,
  method: string,
  reference: string | null,
  requestedBy: string,
) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  if (tierRank(toTier) <= tierRank(org.tier)) {
    throw new Error("That isn't an upgrade from your current package.");
  }

  return prisma.tierChangeRequest.create({
    data: {
      organizationId,
      fromTier: org.tier,
      toTier: toTier as string,
      amount,
      method,
      reference,
      status: "PENDING",
      requestedBy,
    },
  });
}

/** Platform admin confirms a manually-paid upgrade request actually landed — applies the tier change. */
export async function confirmTierRequest(requestId: string, confirmedBy: string) {
  const req = await prisma.tierChangeRequest.findUniqueOrThrow({ where: { id: requestId } });
  if (req.status !== "PENDING") throw new Error("This request has already been decided.");

  await prisma.$transaction([
    prisma.tierChangeRequest.update({
      where: { id: requestId },
      data: { status: "SUCCESS", confirmedBy, confirmedAt: new Date() },
    }),
    prisma.organization.update({ where: { id: req.organizationId }, data: { tier: req.toTier } }),
  ]);
}

/** Platform admin declines a manually-paid upgrade request — no tier change. */
export async function rejectTierRequest(requestId: string, confirmedBy: string) {
  const req = await prisma.tierChangeRequest.findUniqueOrThrow({ where: { id: requestId } });
  if (req.status !== "PENDING") throw new Error("This request has already been decided.");

  await prisma.tierChangeRequest.update({
    where: { id: requestId },
    data: { status: "REJECTED", confirmedBy, confirmedAt: new Date() },
  });
}
