"use server";

import { headers } from "next/headers";
import { prisma } from "./prisma";
import { getSession, requireStaff, requireTenant } from "./auth";
import { stkPush } from "./mpesa";
import { platformMpesaCredentials } from "./licensing";

export type MpesaState = { error?: string; requestId?: string } | undefined;

async function callbackUrl(): Promise<string> {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (envUrl) return `${envUrl}/api/mpesa/callback`;
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  return `${proto}://${host}/api/mpesa/callback`;
}

/**
 * Raises a prompt against a given lease. Shared by both the office button
 * (any lease staff can see, any amount) and the tenant's own "Pay now"
 * (their own active tenancy only) — the caller decides which lease id and
 * phone are allowed to reach here, this just sends it and records it.
 */
async function raise(
  organizationId: string,
  leaseId: string,
  phone: string,
  amount: number,
  initiatedBy: "STAFF" | "TENANT",
): Promise<MpesaState> {
  if (amount <= 0) return { error: "Enter an amount." };

  const [org, lease] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    prisma.lease.findFirst({
      where: { id: leaseId, organizationId },
      select: { id: true, tenant: { select: { name: true } }, unit: { select: { label: true } } },
    }),
  ]);
  if (!lease) return { error: "No such lease." };

  // Commission-routed orgs collect rent through the PLATFORM's own
  // shortcode instead of their own — that's the only way the platform can
  // see and split the payment at all; see app/lib/commission.ts. Every
  // other org keeps using its own credentials exactly as before, unaffected
  // by this flag existing.
  const credentials = org.commissionRouted
    ? platformMpesaCredentials()
    : {
        env: org.mpesaEnv,
        shortcode: org.mpesaShortcode,
        accountType: org.mpesaAccountType,
        consumerKey: org.mpesaConsumerKey,
        consumerSecret: org.mpesaConsumerSecret,
        passkey: org.mpesaPasskey,
      };

  const result = await stkPush(
    credentials,
    {
      phone,
      amount,
      accountReference: lease.unit.label || lease.tenant.name,
      description: "Rent",
      callbackUrl: await callbackUrl(),
    },
  );
  if (!result.ok) return { error: result.reason };

  const request = await prisma.mpesaRequest.create({
    data: {
      organizationId,
      leaseId,
      phone,
      amount: Math.round(amount),
      initiatedBy,
      merchantRequestId: result.merchantRequestId,
      checkoutRequestId: result.checkoutRequestId,
    },
  });

  return { requestId: request.id };
}

/** Office-triggered: staff picks the lease, the amount and (if needed) the phone. */
export async function sendMpesaPrompt(_prev: MpesaState, fd: FormData): Promise<MpesaState> {
  const s = await getSession();
  if (!requireStaff(s)) return { error: "Not allowed." };

  const leaseId = String(fd.get("leaseId") ?? "");
  const phone = String(fd.get("phone") ?? "").trim();
  const amount = Number(fd.get("amount") ?? 0);
  if (!leaseId) return { error: "No lease." };
  if (!phone) return { error: "No phone number to send the prompt to." };

  return raise(s.organizationId, leaseId, phone, amount, "STAFF");
}

/** Tenant-triggered: always their own active tenancy, always their own phone on file. */
export async function payMpesaSelf(_prev: MpesaState, fd: FormData): Promise<MpesaState> {
  const s = await getSession();
  if (!requireTenant(s)) return { error: "Not allowed." };

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: s.tenantId },
    select: { phone: true, leases: { where: { status: "ACTIVE" }, select: { id: true } } },
  });
  if (!tenant.phone) return { error: "No phone number on file — ask the office to add one." };
  const lease = tenant.leases[0];
  if (!lease) return { error: "No active tenancy to pay against." };

  const amount = Number(fd.get("amount") ?? 0);
  return raise(s.organizationId, lease.id, tenant.phone, amount, "TENANT");
}
