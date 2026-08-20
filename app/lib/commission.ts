import "server-only";
import { headers } from "next/headers";
import { prisma } from "./prisma";
import { b2cPayout, type B2cResult } from "./mpesa";
import { platformB2cCredentials, platformB2cConfigured } from "./licensing";

/** The platform-wide default rate — same singleton-row shape as the one TierPrice-style setting this app has. */
export async function getPlatformCommissionPercent(): Promise<number> {
  const row = await prisma.platformSetting.findUnique({ where: { id: "default" } });
  return row?.commissionPercent ?? 0;
}

export async function setPlatformCommissionPercent(percent: number) {
  await prisma.platformSetting.upsert({
    where: { id: "default" },
    create: { id: "default", commissionPercent: percent },
    update: { commissionPercent: percent },
  });
}

/** An org's own negotiated rate if set, else the platform default. */
export async function getEffectiveCommissionPercent(org: { commissionPercent: number | null }): Promise<number> {
  if (org.commissionPercent !== null) return org.commissionPercent;
  return getPlatformCommissionPercent();
}

async function callbackUrl(path: string): Promise<string> {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (envUrl) return `${envUrl}${path}`;
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  return `${proto}://${host}${path}`;
}

/**
 * Called the moment a commission-routed org's tenant rent payment is
 * matched — computes the split and creates the Payout row before ever
 * attempting to move money, so a disbursement that fails or never gets
 * attempted is still a visible PENDING/FAILED row, never a silent gap.
 * Only actually attempts a B2C transfer when the org has both opted in
 * (commissionRouted) and given a payout number, and the platform's own B2C
 * credentials are configured — otherwise the row is left PENDING with a
 * reason recorded, for a platform admin to retry once conditions change.
 */
export async function createPayoutForPayment(organizationId: string, paymentId: string, grossAmount: number) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const percent = await getEffectiveCommissionPercent(org);
  const commissionAmount = Math.round(grossAmount * (percent / 100) * 100) / 100;
  const netAmount = Math.round((grossAmount - commissionAmount) * 100) / 100;

  const payout = await prisma.payout.create({
    data: { organizationId, paymentId, grossAmount, commissionAmount, netAmount, status: "PENDING" },
  });

  if (!org.commissionRouted) {
    return { payout, result: { ok: false, reason: "Organization is not commission-routed." } as B2cResult };
  }
  if (!org.payoutMpesaNumber) {
    return { payout, result: { ok: false, reason: "No payout number on file for this organization." } as B2cResult };
  }
  if (!platformB2cConfigured()) {
    return { payout, result: { ok: false, reason: "Platform B2C payouts are not configured yet." } as B2cResult };
  }

  const result = await b2cPayout(platformB2cCredentials(), {
    phone: org.payoutMpesaNumber,
    amount: netAmount,
    remarks: `Rent payout — ${org.name}`,
    resultUrl: await callbackUrl("/api/mpesa/b2c-callback"),
    timeoutUrl: await callbackUrl("/api/mpesa/b2c-callback"),
  });

  if (result.ok) {
    await prisma.payout.update({
      where: { id: payout.id },
      data: { conversationId: result.conversationId, originatorConversationId: result.originatorConversationId },
    });
  } else {
    await prisma.payout.update({
      where: { id: payout.id },
      data: { status: "FAILED", resultDesc: result.reason },
    });
  }

  return { payout, result };
}
