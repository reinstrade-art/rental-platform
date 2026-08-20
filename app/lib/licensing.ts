import "server-only";
import { prisma } from "./prisma";
import { stkPush, mpesaConfigured, b2cConfigured, type DarajaCredentials, type B2cCredentials } from "./mpesa";
import { TRIAL_DAYS } from "./constants";

export type LicenseState = "TRIAL" | "LICENSED" | "EXPIRED";

/**
 * A customer counts as licensed for as long as EITHER date is still in the
 * future — trial and paid license are two independent windows, not a
 * sequence, so paying early during a trial never forfeits the remaining
 * trial days, and a lapsed trial is simply irrelevant once a license
 * payment has ever landed.
 */
export function licenseState(org: { trialEndsAt: Date | null; licenseExpiresAt: Date | null }, now = new Date()) {
  const trialActive = org.trialEndsAt ? org.trialEndsAt > now : false;
  const licenseActive = org.licenseExpiresAt ? org.licenseExpiresAt > now : false;

  const activeUntil = [org.trialEndsAt, org.licenseExpiresAt]
    .filter((d): d is Date => !!d && d > now)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  const state: LicenseState = licenseActive ? "LICENSED" : trialActive ? "TRIAL" : "EXPIRED";
  const daysLeft = activeUntil ? Math.ceil((activeUntil.getTime() - now.getTime()) / 86_400_000) : null;

  return { state, activeUntil, daysLeft };
}

export function isLicenseActive(org: { trialEndsAt: Date | null; licenseExpiresAt: Date | null }, now = new Date()) {
  return licenseState(org, now).state !== "EXPIRED";
}

export function newTrialEndsAt(now = new Date()): Date {
  return new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
}

/**
 * Records a successful license payment and pushes the license window
 * forward. Extends from whichever is later — the current expiry or now —
 * so paying a few days early never loses those days, and paying late never
 * backdates the new window into the gap that already lapsed.
 */
export async function extendLicense(
  organizationId: string,
  input: { amount: number; method: string; reference: string | null; periodDays: number; recordedBy: string },
) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const base = org.licenseExpiresAt && org.licenseExpiresAt > new Date() ? org.licenseExpiresAt : new Date();
  const licenseExpiresAt = new Date(base.getTime() + input.periodDays * 86_400_000);

  await prisma.$transaction([
    prisma.licensePayment.create({
      data: {
        organizationId,
        amount: input.amount,
        method: input.method,
        reference: input.reference,
        periodDays: input.periodDays,
        status: "SUCCESS",
        recordedBy: input.recordedBy,
      },
    }),
    prisma.organization.update({ where: { id: organizationId }, data: { licenseExpiresAt } }),
  ]);

  return licenseExpiresAt;
}

export function platformMpesaCredentials(): DarajaCredentials {
  return {
    env: process.env.PLATFORM_MPESA_ENV ?? null,
    shortcode: process.env.PLATFORM_MPESA_SHORTCODE ?? null,
    accountType: process.env.PLATFORM_MPESA_ACCOUNT_TYPE ?? null,
    consumerKey: process.env.PLATFORM_MPESA_CONSUMER_KEY ?? null,
    consumerSecret: process.env.PLATFORM_MPESA_CONSUMER_SECRET ?? null,
    passkey: process.env.PLATFORM_MPESA_PASSKEY ?? null,
  };
}

export function platformMpesaConfigured(): boolean {
  return mpesaConfigured(platformMpesaCredentials());
}

/**
 * The platform's own B2C identity — for forwarding a landlord's share of a
 * commission-routed rent payment out of the platform's shortcode. Shares
 * the same shortcode/consumer key/secret/env as the STK credentials above
 * (both are Daraja products on the one platform paybill), plus the three
 * B2C-specific values Safaricom requires: an initiator name, that
 * initiator's password, and Safaricom's own public certificate used to
 * encrypt it per-request. Unset by default — commission payouts stay
 * PENDING (never silently sent) until these are configured.
 */
export function platformB2cCredentials(): B2cCredentials {
  return {
    ...platformMpesaCredentials(),
    initiatorName: process.env.PLATFORM_MPESA_INITIATOR_NAME ?? null,
    initiatorPassword: process.env.PLATFORM_MPESA_INITIATOR_PASSWORD ?? null,
    certPem: process.env.PLATFORM_MPESA_B2C_CERT ?? null,
  };
}

export function platformB2cConfigured(): boolean {
  return b2cConfigured(platformB2cCredentials());
}

/**
 * Raises an STK Push against the PLATFORM's own shortcode — the org paying
 * the platform, the mirror image of an org's own mpesaShortcode (which
 * collects rent from its tenants). Creates a PENDING LicensePayment; the
 * license is extended only once the callback confirms success, same
 * discipline as the tenant-rent STK flow never trusting the raise alone.
 */
export async function sendLicenseStkPush(
  organizationId: string,
  phone: string,
  amount: number,
  periodDays: number,
  recordedBy: string,
  callbackUrl: string,
) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const result = await stkPush(platformMpesaCredentials(), {
    phone,
    amount,
    accountReference: org.name,
    description: "License",
    callbackUrl,
  });
  if (!result.ok) return { ok: false as const, reason: result.reason };

  await prisma.licensePayment.create({
    data: {
      organizationId,
      amount: Math.round(amount),
      method: "MPESA_STK",
      periodDays,
      status: "PENDING",
      merchantRequestId: result.merchantRequestId,
      checkoutRequestId: result.checkoutRequestId,
      recordedBy,
    },
  });
  return { ok: true as const };
}
