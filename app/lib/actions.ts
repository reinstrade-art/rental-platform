"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { prisma } from "./prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { headers } from "next/headers";
import {
  createSession,
  destroySession,
  hashPassword,
  needsPlatformSetup,
  requireStaff,
  requireOrgAdmin,
  requirePlatformAdmin,
  requireTenant,
  requireTenantsAccess,
  isCaretaker,
  verifyCredentials,
  getSession,
  impersonate,
  platformImpersonate,
  endImpersonation,
  revokeSession,
  revokeOtherSessions,
  revokeAllSessions,
} from "./auth";
import { checkLock, recordFailure, clearFailures } from "./throttle";
import { raiseApproval, signApproval } from "./approvals";
import { createInvitation, redeemInvitation, inviteRedirectUrl } from "./invites";
import { ingestTransaction, matchTransaction, ignoreTransaction, parseTransactionsCsv } from "./payments";
import { logPlatformAccess } from "./audit";
import { parsePropertiesCsv, parseTenantsCsv, parseRentRollCsv, ingestRentRoll } from "./import";
import { GROUNDS_LIST, joinGrounds, validNoticeDeadline, sendAndServeNotice } from "./eviction";
import { applyBilling } from "./billing";
import { postRepairExpense } from "./expenses";
import { newTrialEndsAt, extendLicense, sendLicenseStkPush } from "./licensing";
import { requireFeature, getOrgTier, staffSeatLimit, tierRank } from "./tier";
import {
  setTierPrice,
  setOrgTierPrice,
  clearOrgTierPrice,
  getEffectiveTierPrice,
  downgradeTier,
  sendTierUpgradeStk,
  requestTierChangeManual,
  confirmTierRequest,
  rejectTierRequest,
} from "./tier-requests";
import { ORG_TIERS, type OrgTier } from "./constants";
import { setPlatformCommissionPercent } from "./commission";
import { createApiKey, revokeApiKey, deleteApiKey } from "./api-keys";
import { createWebhook, revokeWebhook, dispatchWebhookEvent } from "./webhooks";
import { syncPayment, syncAllUnsyncedPayments } from "./accounting-sync";
import { registerC2bUrls } from "./mpesa";
import { mpesaWebhookKey } from "./webhook-secret";
import { sanitizeMessageBody } from "./sanitize";
import { attachFilesToMessage } from "./attachments";

// --- auth --------------------------------------------------------------

export async function platformSetup(formData: FormData) {
  if (!(await needsPlatformSetup())) errorRedirect("/setup", "Platform is already set up.");

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || password.length < 8) errorRedirect("/setup", "Email and an 8+ character password are required.");

  const user = await prisma.user.create({
    data: { email, passwordHash: await hashPassword(password), role: "PLATFORM_ADMIN" },
  });

  await createSession({ id: user.id, organizationId: null, email: user.email, phone: null, role: user.role });
  redirect("/platform");
}

export async function login(formData: FormData) {
  const identifier = String(formData.get("identifier") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!identifier || !password) errorRedirect("/login", "Enter your email/phone and password.");

  const lock = await checkLock(identifier);
  if (lock.locked) errorRedirect("/login", `Too many attempts. Try again in ${lock.minutesLeft} minute(s).`);

  const user = await verifyCredentials(identifier, password);
  if (!user) {
    const result = await recordFailure(identifier);
    if (result.locked) errorRedirect("/login", `Too many attempts. Try again in ${result.minutesLeft} minute(s).`);
    // Deliberately the same generic message regardless of which part was
    // wrong — confirming "that account doesn't exist" vs "wrong password"
    // separately would let anyone probe which emails/phones are registered.
    errorRedirect("/login", "Incorrect username or password.");
  }
  if (user.disabledAt) errorRedirect("/login", "This account's access has been disabled.");
  await clearFailures(identifier);

  await createSession({
    id: user.id,
    organizationId: user.organizationId,
    email: user.email,
    phone: user.phone,
    role: user.role,
  });

  redirect(user.role === "PLATFORM_ADMIN" ? "/platform" : user.role === "CARETAKER" ? "/tenants" : "/dashboard");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

// --- platform admin: organization provisioning --------------------------

/**
 * Validation failures here redirect back with the message in the query
 * string instead of throwing. A thrown Error's .message is redacted by
 * Next.js in production for any Server Action — replaced with a generic
 * "Minified React error #441" pointer with no real content — so a caught,
 * expected failure (bad input, a duplicate email) needs to travel as data,
 * not an exception, to actually reach the person who needs to see it. The
 * same technique app/(app)/leases/billing-run/page.tsx already uses for its
 * result banner.
 */
export async function createOrganization(formData: FormData) {
  const s = await getSession();
  if (!requirePlatformAdmin(s)) throw new Error("Not authorized.");

  const fail = (message: string) => redirect(`/platform?error=${encodeURIComponent(message)}`);

  const name = String(formData.get("name") ?? "").trim();
  const adminEmail = String(formData.get("adminEmail") ?? "").trim().toLowerCase();
  const adminPassword = String(formData.get("adminPassword") ?? "");
  if (!name || !adminEmail || adminPassword.length < 8) {
    return fail("Organization name, admin email, and an 8+ character password are required.");
  }

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existing) return fail("That email is already in use by another account.");

  // Batched (array form), not an interactive callback transaction — a hosted
  // database reached over HTTP (Turso in production) doesn't hold an
  // interactive transaction open reliably, the same reason applyBilling
  // avoids one (see app/lib/billing.ts). The id is generated here so the
  // user row can be built up front and both writes submitted as one batch.
  const orgId = crypto.randomUUID();
  const passwordHash = await hashPassword(adminPassword);
  await prisma.$transaction([
    prisma.organization.create({ data: { id: orgId, name, trialEndsAt: newTrialEndsAt() } }),
    prisma.user.create({
      data: {
        organizationId: orgId,
        email: adminEmail,
        passwordHash,
        role: "ADMIN",
        // Seeded so the approval chain isn't inert on day one — mirrors the
        // reference build's own migration (ADMIN → DIRECTOR).
        approvalLevel: "DIRECTOR",
      },
    }),
  ]);

  redirect("/platform");
}

export async function setOrganizationStatus(organizationId: string, status: "ACTIVE" | "SUSPENDED") {
  const s = await getSession();
  if (!requirePlatformAdmin(s)) throw new Error("Not authorized.");
  await prisma.organization.update({ where: { id: organizationId }, data: { status } });
  await logPlatformAccess(s.userId, organizationId, status === "SUSPENDED" ? "SUSPEND_ORG" : "REACTIVATE_ORG");
}

/** Renames a customer — the only field a platform admin edits inline from the org list. */
export async function updateOrganization(organizationId: string, formData: FormData) {
  const s = await getSession();
  if (!requirePlatformAdmin(s)) throw new Error("Not authorized.");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect(`/platform?error=${encodeURIComponent("Organization name is required.")}`);

  await prisma.organization.update({ where: { id: organizationId }, data: { name } });
  await logPlatformAccess(s.userId, organizationId, "VIEW_ORG_DETAIL", `Renamed to ${name}`);
  redirect("/platform");
}

/**
 * Removes an organization outright — only when it's still empty (no
 * properties, tenants, or vendors), so this reaches botched or test
 * onboarding, never a customer with real data. A real customer is retired
 * via setOrganizationStatus(SUSPENDED) instead, which keeps their history.
 */
export async function deleteOrganization(organizationId: string) {
  const s = await getSession();
  if (!requirePlatformAdmin(s)) throw new Error("Not authorized.");

  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) redirect(`/platform?error=${encodeURIComponent("Organization not found.")}`);

  const [properties, tenants, vendors] = await Promise.all([
    prisma.property.count({ where: { organizationId } }),
    prisma.tenant.count({ where: { organizationId } }),
    prisma.vendor.count({ where: { organizationId } }),
  ]);
  if (properties || tenants || vendors) {
    redirect(`/platform?error=${encodeURIComponent("This organization has data on file — suspend it instead of deleting, to keep its history.")}`);
  }

  await prisma.invitation.deleteMany({ where: { organizationId } });
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  await prisma.user.deleteMany({ where: { organizationId } }); // sessions cascade with the user
  await prisma.organization.delete({ where: { id: organizationId } });

  redirect("/platform");
}

/** Sets which commercial package a customer is on — see FEATURE_TIER in app/lib/constants.ts for what each unlocks. */
export async function updateOrgTier(organizationId: string, formData: FormData) {
  const s = await getSession();
  if (!requirePlatformAdmin(s)) throw new Error("Not authorized.");

  const tier = String(formData.get("tier") ?? "");
  if (!ORG_TIERS.includes(tier as (typeof ORG_TIERS)[number])) errorRedirect(`/platform/${organizationId}`, "Invalid tier.");

  await prisma.organization.update({ where: { id: organizationId }, data: { tier } });
  await logPlatformAccess(s.userId, organizationId, "SET_ORG_TIER", `Tier set to ${tier}`);
  redirect(`/platform/${organizationId}`);
}

/** Sets what a customer is actually being charged — a platform admin's own negotiated figure, not a fixed platform-wide price. */
export async function updateLicenseFee(organizationId: string, formData: FormData) {
  const s = await getSession();
  if (!requirePlatformAdmin(s)) throw new Error("Not authorized.");

  const licenseFeeKes = Number(formData.get("licenseFeeKes") ?? 0) || null;
  await prisma.organization.update({ where: { id: organizationId }, data: { licenseFeeKes } });
}

/** A platform admin recording a license payment received outside M-Pesa (bank transfer, cash) — extends the license immediately. */
export async function recordLicensePayment(organizationId: string, formData: FormData) {
  const s = await getSession();
  if (!requirePlatformAdmin(s)) throw new Error("Not authorized.");

  const amount = Number(formData.get("amount") ?? 0);
  const method = String(formData.get("method") ?? "BANK");
  const reference = String(formData.get("reference") ?? "").trim() || null;
  const periodDays = Number(formData.get("periodDays") ?? 30) || 30;
  if (!amount || amount <= 0) errorRedirect(`/platform/${organizationId}`, "Enter a positive amount.");

  await extendLicense(organizationId, { amount, method, reference, periodDays, recordedBy: s.userId });
  await logPlatformAccess(s.userId, organizationId, "RECORD_LICENSE_PAYMENT", `KES ${amount} via ${method}`);
  redirect("/platform");
}

/** A platform admin billing a customer for their license over the platform's own M-Pesa shortcode. */
export async function sendLicenseStkAction(organizationId: string, formData: FormData) {
  const s = await getSession();
  if (!requirePlatformAdmin(s)) throw new Error("Not authorized.");

  const phone = String(formData.get("phone") ?? "").trim();
  const amount = Number(formData.get("amount") ?? 0);
  const periodDays = Number(formData.get("periodDays") ?? 30) || 30;
  if (!phone) errorRedirect(`/platform/${organizationId}`, "Enter a phone number to send the prompt to.");
  if (!amount || amount <= 0) errorRedirect(`/platform/${organizationId}`, "Enter a positive amount.");

  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  const callbackUrl = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/mpesa/license-callback`
    : `${proto}://${host}/api/mpesa/license-callback`;

  const result = await sendLicenseStkPush(organizationId, phone, amount, periodDays, s.userId, callbackUrl);
  if (!result.ok) errorRedirect(`/platform/${organizationId}`, result.reason);
  await logPlatformAccess(s.userId, organizationId, "SEND_LICENSE_STK", `KES ${amount} to ${phone}`);
  redirect("/platform");
}

// --- tier pricing & self-service upgrades/downgrades --------------------

/** Platform admin sets the platform's own price list — global, not per-org. */
export async function setTierPriceAction(tier: string, formData: FormData) {
  const s = await getSession();
  if (!requirePlatformAdmin(s)) throw new Error("Not authorized.");
  if (!(ORG_TIERS as readonly string[]).includes(tier)) errorRedirect("/platform", "Unknown package.");

  const priceKes = Number(formData.get("priceKes") ?? 0);
  if (!priceKes || priceKes < 0) errorRedirect("/platform", "Enter a valid price.");

  await setTierPrice(tier as OrgTier, priceKes);
  redirect("/platform?priceSaved=1");
}

/** Platform admin sets (or clears) a negotiated price for one org's upgrade to a specific tier — overrides the global price list for that org only. */
export async function setOrgTierPriceAction(organizationId: string, tier: string, formData: FormData) {
  const s = await getSession();
  if (!requirePlatformAdmin(s)) throw new Error("Not authorized.");
  if (!(ORG_TIERS as readonly string[]).includes(tier)) errorRedirect(`/platform/${organizationId}`, "Unknown package.");

  const raw = String(formData.get("priceKes") ?? "").trim();
  if (!raw) {
    await clearOrgTierPrice(organizationId, tier as OrgTier);
    redirect(`/platform/${organizationId}?priceSaved=1`);
  }

  const priceKes = Number(raw);
  if (!priceKes || priceKes < 0) errorRedirect(`/platform/${organizationId}`, "Enter a valid price, or leave it blank to remove the override.");

  await setOrgTierPrice(organizationId, tier as OrgTier, priceKes);
  redirect(`/platform/${organizationId}?priceSaved=1`);
}

/** Platform admin sets the platform-wide default commission rate on tenant rent payments — see app/lib/commission.ts. */
export async function setPlatformCommissionAction(formData: FormData) {
  const s = await getSession();
  if (!requirePlatformAdmin(s)) throw new Error("Not authorized.");

  const percent = Number(formData.get("commissionPercent") ?? "");
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    errorRedirect("/platform", "Enter a commission rate between 0 and 100.");
  }

  await setPlatformCommissionPercent(percent);
  redirect("/platform?priceSaved=1");
}

/** Platform admin sets (or clears) a negotiated commission rate for one org — overrides the platform default for that org only. */
export async function setOrgCommissionAction(organizationId: string, formData: FormData) {
  const s = await getSession();
  if (!requirePlatformAdmin(s)) throw new Error("Not authorized.");

  const raw = String(formData.get("commissionPercent") ?? "").trim();
  if (!raw) {
    await prisma.organization.update({ where: { id: organizationId }, data: { commissionPercent: null } });
    redirect(`/platform/${organizationId}?priceSaved=1`);
  }

  const percent = Number(raw);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    errorRedirect(`/platform/${organizationId}`, "Enter a commission rate between 0 and 100, or leave it blank to use the platform default.");
  }

  await prisma.organization.update({ where: { id: organizationId }, data: { commissionPercent: percent } });
  redirect(`/platform/${organizationId}?priceSaved=1`);
}

/**
 * Platform admin flips whether this org's tenant rent collection routes
 * through the platform's own shortcode (so it can be split) or stays on the
 * org's own paybill (the ordinary, unmodified behavior). Deliberately never
 * self-serve — see the commissionRouted field comment in schema.prisma for
 * why this is an explicit, one-org-at-a-time decision.
 */
export async function setCommissionRoutedAction(organizationId: string, routed: boolean) {
  const s = await getSession();
  if (!requirePlatformAdmin(s)) throw new Error("Not authorized.");
  await prisma.organization.update({ where: { id: organizationId }, data: { commissionRouted: routed } });
  redirect(`/platform/${organizationId}?priceSaved=1`);
}

/** An org admin dropping to a cheaper (or free) package — free, applied immediately. */
export async function downgradeTierAction(formData: FormData) {
  const s = await getSession();
  if (!requireOrgAdmin(s)) throw new Error("Not authorized.");

  const toTier = String(formData.get("toTier") ?? "");
  if (!(ORG_TIERS as readonly string[]).includes(toTier)) errorRedirect("/settings/plan", "Unknown package.");

  try {
    await downgradeTier(s.organizationId, toTier as OrgTier, s.userId);
  } catch (e) {
    errorRedirect("/settings/plan", e instanceof Error ? e.message : "Could not downgrade.");
  }
  redirect("/settings/plan?downgraded=1");
}

/**
 * An org admin requesting an upgrade. M-Pesa raises an STK prompt they pay
 * themselves, confirmed automatically by the callback. Any other method
 * (bank/cash/other) is recorded PENDING — real money changed hands outside
 * this app, so a platform admin has to confirm it actually landed before the
 * package changes; nothing here can verify that on its own.
 */
export async function requestTierUpgrade(formData: FormData) {
  const s = await getSession();
  if (!requireOrgAdmin(s)) throw new Error("Not authorized.");

  const toTier = String(formData.get("toTier") ?? "");
  if (!(ORG_TIERS as readonly string[]).includes(toTier)) errorRedirect("/settings/plan", "Unknown package.");

  const amount = await getEffectiveTierPrice(s.organizationId, toTier as OrgTier);
  if (!amount) errorRedirect("/settings/plan", "This package doesn't have a price set yet — contact us to upgrade.");

  const method = String(formData.get("method") ?? "MPESA_STK");

  if (method === "MPESA_STK") {
    const phone = String(formData.get("phone") ?? "").trim();
    if (!phone) errorRedirect("/settings/plan", "Enter a phone number to send the prompt to.");

    const h = await headers();
    const host = h.get("host");
    const proto = h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
    const callbackUrl = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/api/mpesa/tier-callback`
      : `${proto}://${host}/api/mpesa/tier-callback`;

    try {
      const result = await sendTierUpgradeStk(s.organizationId, toTier as OrgTier, phone, amount, s.userId, callbackUrl);
      if (!result.ok) errorRedirect("/settings/plan", result.reason);
    } catch (e) {
      errorRedirect("/settings/plan", e instanceof Error ? e.message : "Could not send the prompt.");
    }
    redirect("/settings/plan?requested=1");
  }

  const reference = String(formData.get("reference") ?? "").trim() || null;
  try {
    await requestTierChangeManual(s.organizationId, toTier as OrgTier, amount, method, reference, s.userId);
  } catch (e) {
    errorRedirect("/settings/plan", e instanceof Error ? e.message : "Could not record the request.");
  }
  redirect("/settings/plan?requested=1");
}

/** Platform admin confirms a manually-paid upgrade request landed — applies the tier. */
export async function confirmTierRequestAction(requestId: string) {
  const s = await getSession();
  if (!requirePlatformAdmin(s)) throw new Error("Not authorized.");
  try {
    await confirmTierRequest(requestId, s.userId);
  } catch (e) {
    errorRedirect("/platform", e instanceof Error ? e.message : "Could not confirm this request.");
  }
  redirect("/platform");
}

/** Platform admin declines a manually-paid upgrade request. */
export async function rejectTierRequestAction(requestId: string) {
  const s = await getSession();
  if (!requirePlatformAdmin(s)) throw new Error("Not authorized.");
  try {
    await rejectTierRequest(requestId, s.userId);
  } catch (e) {
    errorRedirect("/platform", e instanceof Error ? e.message : "Could not reject this request.");
  }
  redirect("/platform");
}

/** Staff set their own organization's document letterhead — never another org's. */
export async function updateBranding(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const brandColor = String(formData.get("brandColor") ?? "").trim();
  if (brandColor && !/^#[0-9a-fA-F]{6}$/.test(brandColor)) {
    errorRedirect("/settings", "Brand color must be a hex value like #1E3350.");
  }

  await prisma.organization.update({
    where: { id: s.organizationId },
    data: {
      letterheadName: String(formData.get("letterheadName") ?? "").trim() || null,
      letterheadAddress: String(formData.get("letterheadAddress") ?? "").trim() || null,
      letterheadPhone: String(formData.get("letterheadPhone") ?? "").trim() || null,
      letterheadEmail: String(formData.get("letterheadEmail") ?? "").trim() || null,
      brandColor: brandColor || null,
    },
  });
  redirect("/settings");
}

/**
 * The organization's own tenancy-agreement terms, printed into every lease
 * PDF verbatim. Deliberately free text, not a set of clauses this app
 * drafts — see the comment on Organization.leaseTermsTemplate.
 */
export async function updateLeaseTerms(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  await prisma.organization.update({
    where: { id: s.organizationId },
    data: { leaseTermsTemplate: String(formData.get("leaseTermsTemplate") ?? "").trim() || null },
  });
  redirect("/settings");
}

/** Only an org admin configures the org's own Daraja credentials — this is the org's own paybill/till, not a shared platform one. */
export async function updateMpesaSettings(formData: FormData) {
  const s = await getSession();
  if (!requireOrgAdmin(s)) throw new Error("Only an organization admin can configure M-Pesa.");

  const env = String(formData.get("mpesaEnv") ?? "sandbox");
  if (env !== "sandbox" && env !== "production") errorRedirect("/settings", "Invalid environment.");

  const accountType = String(formData.get("mpesaAccountType") ?? "PAYBILL");
  if (accountType !== "PAYBILL" && accountType !== "TILL") errorRedirect("/settings", "Invalid account type.");

  await prisma.organization.update({
    where: { id: s.organizationId },
    data: {
      mpesaEnv: env,
      mpesaAccountType: accountType,
      mpesaShortcode: String(formData.get("mpesaShortcode") ?? "").trim() || null,
      mpesaConsumerKey: String(formData.get("mpesaConsumerKey") ?? "").trim() || null,
      mpesaConsumerSecret: String(formData.get("mpesaConsumerSecret") ?? "").trim() || null,
      mpesaPasskey: String(formData.get("mpesaPasskey") ?? "").trim() || null,
    },
  });
  redirect("/settings");
}

/**
 * One-time call telling Safaricom to POST every C2B payment on this org's
 * paybill to its own signed webhook URL — see registerC2bUrls in mpesa.ts
 * and the key in webhook-secret.ts. Once registered, a tenant paying with
 * their unit's payment code as the M-Pesa account number gets matched and
 * recorded automatically, the same way an STK Push payment already is.
 */
export async function registerMpesaC2bAction() {
  const s = await getSession();
  if (!requireOrgAdmin(s)) throw new Error("Only an organization admin can register M-Pesa C2B.");

  const org = await prisma.organization.findUniqueOrThrow({ where: { id: s.organizationId } });
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${h.get("host")}`;
  const confirmationUrl = `${origin}/api/webhooks/mpesa/${s.organizationId}/${mpesaWebhookKey(s.organizationId)}`;

  const result = await registerC2bUrls(
    {
      env: org.mpesaEnv,
      shortcode: org.mpesaShortcode,
      accountType: org.mpesaAccountType,
      consumerKey: org.mpesaConsumerKey,
      consumerSecret: org.mpesaConsumerSecret,
      passkey: org.mpesaPasskey,
    },
    confirmationUrl,
  );

  if (!result.ok) errorRedirect("/settings", result.reason);
  redirect("/settings?c2bRegistered=1");
}

/**
 * Where the platform sends this org's share once (and if) a platform admin
 * turns commission routing on for them — set by the org's own ADMIN, never
 * chosen on their behalf. Harmless to fill in ahead of time: unused until
 * that switch is flipped.
 */
export async function updatePayoutMpesaNumber(formData: FormData) {
  const s = await getSession();
  if (!requireOrgAdmin(s)) throw new Error("Only an organization admin can set the payout number.");

  await prisma.organization.update({
    where: { id: s.organizationId },
    data: { payoutMpesaNumber: String(formData.get("payoutMpesaNumber") ?? "").trim() || null },
  });
  redirect("/settings");
}

export type ApiKeyState = { error?: string; rawKey?: string; name?: string } | undefined;

/**
 * Returns the raw key in the action's own result rather than redirecting —
 * a secret has no business ever appearing in a URL (browser history, server
 * logs, a Referer header), so this is rendered by a client component using
 * useActionState instead of the usual redirect-and-reread pattern.
 */
export async function createApiKeyAction(_prev: ApiKeyState, formData: FormData): Promise<ApiKeyState> {
  const s = await getSession();
  if (!requireOrgAdmin(s)) return { error: "Only an organization admin can create API keys." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give the key a name so you can tell it apart later." };

  const { raw } = await createApiKey(s.organizationId, name, s.userId);
  return { rawKey: raw, name };
}

export async function revokeApiKeyAction(keyId: string) {
  const s = await getSession();
  if (!requireOrgAdmin(s)) throw new Error("Only an organization admin can revoke API keys.");
  await revokeApiKey(s.organizationId, keyId);
  redirect("/settings");
}

/** Only reaches a row at all for keys that are both revoked and never used -- see deleteApiKey()'s own where clause for why. */
export async function deleteApiKeyAction(keyId: string) {
  const s = await getSession();
  if (!requireOrgAdmin(s)) throw new Error("Only an organization admin can delete API keys.");
  await deleteApiKey(s.organizationId, keyId);
  redirect("/settings");
}

export type WebhookState = { error?: string; secret?: string; url?: string } | undefined;

/** Same reasoning as createApiKeyAction — the secret is returned in the action's own result, never a redirect URL. */
export async function createWebhookAction(_prev: WebhookState, formData: FormData): Promise<WebhookState> {
  const s = await getSession();
  if (!requireOrgAdmin(s)) return { error: "Only an organization admin can add a webhook." };

  const url = String(formData.get("url") ?? "").trim();
  if (!url) return { error: "Enter a URL to send events to." };
  if (!/^https:\/\//.test(url)) return { error: "The URL must be https:// — a plain http endpoint can't be trusted with a signed secret." };

  const hook = await createWebhook(s.organizationId, url, s.userId);
  return { url, secret: hook.secret };
}

export async function revokeWebhookAction(webhookId: string) {
  const s = await getSession();
  if (!requireOrgAdmin(s)) throw new Error("Only an organization admin can revoke a webhook.");
  await revokeWebhook(s.organizationId, webhookId);
  redirect("/settings");
}

export async function disconnectQuickbooksAction() {
  const s = await getSession();
  if (!requireOrgAdmin(s)) throw new Error("Only an organization admin can disconnect QuickBooks.");
  await prisma.accountingConnection.deleteMany({ where: { organizationId: s.organizationId, provider: "QUICKBOOKS" } });
  redirect("/settings");
}

/** The QuickBooks account IDs journal entries post against — see quickbooks.ts's syncPaymentToQuickbooks for why this can't be guessed. */
export async function setQuickbooksAccountsAction(formData: FormData) {
  const s = await getSession();
  if (!requireOrgAdmin(s)) throw new Error("Only an organization admin can configure QuickBooks accounts.");

  const incomeAccountId = String(formData.get("incomeAccountId") ?? "").trim() || null;
  const bankAccountId = String(formData.get("bankAccountId") ?? "").trim() || null;

  await prisma.accountingConnection.updateMany({
    where: { organizationId: s.organizationId, provider: "QUICKBOOKS" },
    data: { incomeAccountId, bankAccountId },
  });
  redirect("/settings?qbConnected=1");
}

/** Manually catches up any payment that never made it into QuickBooks — the same sync every new payment triggers automatically, run on demand. */
export async function syncQuickbooksNowAction() {
  const s = await getSession();
  if (!requireOrgAdmin(s)) throw new Error("Only an organization admin can trigger a sync.");
  const { attempted } = await syncAllUnsyncedPayments(s.organizationId);
  redirect(`/settings?qbSynced=${attempted}`);
}

// --- staff: property / unit / tenant / lease / billing -------------------

export async function createProperty(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim() || null;
  if (!name) errorRedirect("/properties", "Property name is required.");

  await prisma.property.create({ data: { organizationId: s.organizationId, name, address } });
  redirect("/properties");
}

export async function updateProperty(propertyId: string, formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const property = await prisma.property.findFirst({ where: { id: propertyId, organizationId: s.organizationId } });
  if (!property) errorRedirect("/properties", "Property not found.");

  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim() || null;
  if (!name) errorRedirect(`/properties/${propertyId}/edit`, "Property name is required.");

  await prisma.property.update({ where: { id: propertyId }, data: { name, address } });
  redirect("/properties");
}

/** Blocked while units remain, since deleting the row would otherwise fail the FK to Unit — the office removes units first, deliberately, rather than the delete silently cascading away leases/charges/payments underneath them. */
export async function deleteProperty(propertyId: string) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const property = await prisma.property.findFirst({
    where: { id: propertyId, organizationId: s.organizationId },
    include: { units: true },
  });
  if (!property) throw new Error("Property not found.");
  if (property.units.length > 0) errorRedirect("/properties", "Remove this property's units before deleting it.");

  await prisma.property.delete({ where: { id: propertyId } });
  redirect("/properties");
}

/**
 * Redirects with a message a page can read from searchParams and show
 * inline, instead of throwing. Next.js redacts a thrown Error's message in
 * production (only the server log keeps it, via error.digest) — fine for a
 * truly unexpected failure, but a CSV with a typo'd header is an EXPECTED
 * outcome that deserves to say what actually went wrong.
 */
function errorRedirect(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

/** One row per property: name,address — header row optional. */
export async function importPropertiesCsv(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");
  requireFeature(await getOrgTier(s.organizationId), "CSV_IMPORT");

  const file = formData.get("file");
  if (!(file instanceof File)) errorRedirect("/properties", "Choose a CSV file.");
  const rows = parsePropertiesCsv(await file.text());
  if (rows.length === 0) errorRedirect("/properties", "No valid rows found — expected name,address per line.");

  for (const row of rows) {
    await prisma.property.create({ data: { organizationId: s.organizationId, name: row.name, address: row.address } });
  }
  redirect("/properties");
}

export async function createUnit(propertyId: string, formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const property = await prisma.property.findFirst({
    where: { id: propertyId, organizationId: s.organizationId },
  });
  if (!property) errorRedirect("/properties", "Property not found.");

  const label = String(formData.get("label") ?? "").trim();
  const monthlyRent = Number(formData.get("monthlyRent") ?? 0) || null;
  if (!label) errorRedirect(`/properties/${propertyId}`, "Unit label is required.");

  await prisma.unit.create({
    data: { organizationId: s.organizationId, propertyId, label, monthlyRent },
  });
  redirect(`/properties/${propertyId}`);
}

export async function updateUnit(unitId: string, formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const unit = await prisma.unit.findFirst({ where: { id: unitId, organizationId: s.organizationId } });
  if (!unit) throw new Error("Unit not found.");

  const label = String(formData.get("label") ?? "").trim();
  if (!label) errorRedirect(`/properties/${unit.propertyId}`, "Unit label is required.");

  const monthlyRent = Number(formData.get("monthlyRent") ?? 0) || null;
  const paymentCode = String(formData.get("paymentCode") ?? "").trim() || null;

  await prisma.unit.update({ where: { id: unitId }, data: { label, monthlyRent, paymentCode } });
  redirect(`/properties/${unit.propertyId}?saved=${unitId}`);
}

export async function createTenant(formData: FormData) {
  const s = await getSession();
  if (!requireTenantsAccess(s)) throw new Error("Not authorized.");

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;
  if (!name) errorRedirect("/tenants/new", "Tenant name is required.");

  // A caretaker works one property, never the whole org — tag the tenant
  // with it now, since there's no lease yet to scope by later.
  const propertyId = isCaretaker(s.role) ? s.propertyId : null;
  const tenant = await prisma.tenant.create({ data: { organizationId: s.organizationId, propertyId, name, phone, email } });

  // A prospective tenant who isn't in the system yet — add the record and
  // send the registration invite in the same step, rather than making staff
  // create the tenant first and come back to invite them separately.
  if (formData.get("inviteNow") === "on") {
    if (!phone && !email) {
      errorRedirect(`/tenants/${tenant.id}`, "Added, but a phone or email is needed before inviting — add one, then invite.");
    }
    const invite = await createInvitation(s.organizationId, "TENANT", { tenantId: tenant.id }, { email: email ?? undefined, phone: phone ?? undefined });
    redirect(inviteRedirectUrl(invite));
  }

  redirect("/tenants");
}

export async function updateTenant(tenantId: string, formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, organizationId: s.organizationId } });
  if (!tenant) errorRedirect("/tenants", "Tenant not found.");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) errorRedirect(`/tenants/${tenantId}/edit`, "Tenant name is required.");

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      name,
      phone: String(formData.get("phone") ?? "").trim() || null,
      email: String(formData.get("email") ?? "").trim() || null,
    },
  });
  redirect(`/tenants/${tenantId}`);
}

/** Blocked while leases or portal access remain attached — both are FKs to this row, so the office clears them first rather than the delete cascading history away. */
export async function deleteTenant(tenantId: string) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, organizationId: s.organizationId },
    include: { leases: true, user: true },
  });
  if (!tenant) throw new Error("Tenant not found.");
  if (tenant.leases.length > 0) errorRedirect(`/tenants/${tenantId}`, "Remove this tenant's leases before deleting them.");
  if (tenant.user) errorRedirect(`/tenants/${tenantId}`, "This tenant has portal access — disable it before deleting.");

  await prisma.tenant.delete({ where: { id: tenantId } });
  redirect("/tenants");
}

/** One row per tenant: name,phone,email — header row optional. */
export async function importTenantsCsv(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");
  requireFeature(await getOrgTier(s.organizationId), "CSV_IMPORT");

  const file = formData.get("file");
  if (!(file instanceof File)) errorRedirect("/tenants", "Choose a CSV file.");
  const rows = parseTenantsCsv(await file.text());
  if (rows.length === 0) errorRedirect("/tenants", "No valid rows found — expected name,phone,email per line.");

  for (const row of rows) {
    await prisma.tenant.create({ data: { organizationId: s.organizationId, name: row.name, phone: row.phone, email: row.email } });
  }
  redirect("/tenants");
}

export async function createLease(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const unitId = String(formData.get("unitId") ?? "");
  let tenantId = String(formData.get("tenantId") ?? "");
  const newTenantName = String(formData.get("newTenantName") ?? "").trim();
  const monthlyRent = Number(formData.get("monthlyRent") ?? 0);
  const startDate = new Date(String(formData.get("startDate") ?? ""));
  if (!unitId || (!tenantId && !newTenantName) || !monthlyRent || isNaN(startDate.getTime())) {
    errorRedirect(`/leases/new?unitId=${unitId}`, "Unit, a tenant (existing or new), monthly rent, and a valid start date are required.");
  }

  const unit = await prisma.unit.findFirst({ where: { id: unitId, organizationId: s.organizationId } });
  if (!unit) errorRedirect("/leases/new", "Unit not found.");

  // A brand-new tenant, named right here rather than requiring a separate
  // trip to Tenants → Add tenant first — the two-step version was the
  // actual gap: this page's tenant field was a dropdown of tenants who
  // already existed, with no way to type a new one's name in.
  if (!tenantId && newTenantName) {
    const newTenantPhone = String(formData.get("newTenantPhone") ?? "").trim() || null;
    const newTenantEmail = String(formData.get("newTenantEmail") ?? "").trim() || null;
    const tenant = await prisma.tenant.create({
      data: { organizationId: s.organizationId, name: newTenantName, phone: newTenantPhone, email: newTenantEmail },
    });
    tenantId = tenant.id;
  } else {
    const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, organizationId: s.organizationId } });
    if (!tenant) errorRedirect(`/leases/new?unitId=${unitId}`, "Tenant not found.");
  }

  await prisma.lease.create({
    data: { organizationId: s.organizationId, unitId, tenantId, monthlyRent, startDate, status: "ACTIVE" },
  });
  redirect("/leases");
}

/**
 * Tenant/unit are correctable here — for a lease created against the wrong
 * person, or matched to the wrong unit by an import — not for a genuine
 * move, which belongs in a new lease instead so the old unit's history
 * stays attached to it rather than being silently carried to a new one.
 */
export async function updateLease(leaseId: string, formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const lease = await prisma.lease.findFirst({ where: { id: leaseId, organizationId: s.organizationId } });
  if (!lease) errorRedirect("/leases", "Lease not found.");

  const tenantId = String(formData.get("tenantId") ?? "").trim() || lease.tenantId;
  const unitId = String(formData.get("unitId") ?? "").trim() || lease.unitId;
  const monthlyRent = Number(formData.get("monthlyRent") ?? 0);
  const startDate = new Date(String(formData.get("startDate") ?? ""));
  const endDateRaw = String(formData.get("endDate") ?? "").trim();
  const endDate = endDateRaw ? new Date(endDateRaw) : null;
  const status = String(formData.get("status") ?? lease.status);
  const editPath = `/leases/${leaseId}/edit`;
  if (!monthlyRent || isNaN(startDate.getTime())) errorRedirect(editPath, "Monthly rent and a valid start date are required.");
  if (endDateRaw && isNaN((endDate as Date).getTime())) errorRedirect(editPath, "Invalid end date.");
  if (status !== "ACTIVE" && status !== "ENDED") errorRedirect(editPath, "Invalid status.");

  if (tenantId !== lease.tenantId) {
    const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, organizationId: s.organizationId } });
    if (!tenant) errorRedirect(editPath, "Tenant not found.");
  }
  if (unitId !== lease.unitId) {
    const unit = await prisma.unit.findFirst({ where: { id: unitId, organizationId: s.organizationId } });
    if (!unit) errorRedirect(editPath, "Unit not found.");
  }

  await prisma.lease.update({ where: { id: leaseId }, data: { tenantId, unitId, monthlyRent, startDate, endDate, status } });
  redirect("/leases");
}

/** Blocked once charges or payments exist — deleting would erase real financial history, so ending the lease (status ENDED) is the correct action at that point instead. */
export async function deleteLease(leaseId: string) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const lease = await prisma.lease.findFirst({
    where: { id: leaseId, organizationId: s.organizationId },
    include: { charges: true, payments: true, evictions: true },
  });
  if (!lease) throw new Error("Lease not found.");
  if (lease.charges.length > 0 || lease.payments.length > 0) {
    errorRedirect("/leases", "This lease has charges or payments on record — end it instead of deleting, to keep the financial history.");
  }
  if (lease.evictions.length > 0) {
    errorRedirect("/leases", "This lease has an eviction case on record — end the lease instead of deleting, to keep that history.");
  }

  await prisma.lease.delete({ where: { id: leaseId } });
  redirect("/leases");
}

/**
 * For a genuine data-entry duplicate (e.g. a tenant imported twice onto the
 * same unit) that deleteLease refuses to touch because it already has
 * charges or payments recorded. Admin-only, since it destroys financial
 * history rather than just archiving it — the normal "end the lease"
 * (status ENDED) path is always the first option offered, this is only for
 * when the lease itself should never have existed.
 */
export async function forceDeleteLease(leaseId: string) {
  const s = await getSession();
  if (!requireOrgAdmin(s)) throw new Error("Only an organization admin can force-delete a lease with financial history.");

  const lease = await prisma.lease.findFirst({ where: { id: leaseId, organizationId: s.organizationId } });
  if (!lease) throw new Error("Lease not found.");

  await prisma.charge.deleteMany({ where: { leaseId, organizationId: s.organizationId } });
  await prisma.payment.deleteMany({ where: { leaseId, organizationId: s.organizationId } });
  await prisma.eviction.deleteMany({ where: { leaseId, organizationId: s.organizationId } });
  await prisma.lease.delete({ where: { id: leaseId } });
  redirect("/leases");
}

/**
 * Imports a rent roll (Unit #, Tenant, Month, Year, Expected Rent, Billed
 * Rent, RENT Paid) against one selected property, creating/updating units,
 * tenants, and leases and recording each period's charge/payment — the same
 * shape a landlord's own spreadsheet already uses, so no manual re-entry of
 * data that's already been captured once.
 */
export async function importRentRoll(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");
  requireFeature(await getOrgTier(s.organizationId), "CSV_IMPORT");

  const propertyId = String(formData.get("propertyId") ?? "");
  const property = await prisma.property.findFirst({ where: { id: propertyId, organizationId: s.organizationId } });
  if (!property) errorRedirect("/leases", "Select a property to import into.");

  const file = formData.get("file");
  if (!(file instanceof File)) errorRedirect("/leases", "Choose a CSV file.");
  const rows = parseRentRollCsv(await file.text());
  if (rows.length === 0) {
    errorRedirect(
      "/leases",
      "No valid rows found — expected a header row with columns like Unit #, Tenant, Month, Year, Expected Rent, Billed Rent, RENT Paid.",
    );
  }

  await ingestRentRoll(s.organizationId, propertyId, rows);
  redirect("/leases");
}

export async function addCharge(leaseId: string, formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const lease = await prisma.lease.findFirst({ where: { id: leaseId, organizationId: s.organizationId } });
  if (!lease) throw new Error("Lease not found.");

  const type = String(formData.get("type") ?? "RENT");
  const amount = Number(formData.get("amount") ?? 0);
  const description = String(formData.get("description") ?? "").trim() || null;
  const periodMonth = new Date(String(formData.get("periodMonth") ?? ""));
  if (!amount || isNaN(periodMonth.getTime())) {
    errorRedirect(`/leases/${leaseId}`, "Amount and period month are required.");
  }

  const charge = await prisma.charge.create({
    data: { organizationId: s.organizationId, leaseId, type, amount, description, periodMonth },
  });
  after(() =>
    dispatchWebhookEvent(s.organizationId, "charge.added", {
      id: charge.id,
      leaseId,
      type,
      amount,
      periodMonth: periodMonth.toISOString().slice(0, 7),
    }),
  );
  redirect(`/leases/${leaseId}`);
}

export async function recordPayment(leaseId: string, formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const lease = await prisma.lease.findFirst({ where: { id: leaseId, organizationId: s.organizationId } });
  if (!lease) throw new Error("Lease not found.");

  const amount = Number(formData.get("amount") ?? 0);
  const method = String(formData.get("method") ?? "").trim() || null;
  const reference = String(formData.get("reference") ?? "").trim() || null;
  const paidAt = new Date(String(formData.get("paidAt") ?? new Date().toISOString()));
  if (!amount) errorRedirect(`/leases/${leaseId}`, "Amount is required.");

  let payment;
  try {
    payment = await prisma.payment.create({
      data: { organizationId: s.organizationId, leaseId, amount, method, reference, paidAt },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      errorRedirect(`/leases/${leaseId}`, "That reference has already been recorded against another payment.");
    }
    throw e;
  }
  after(() =>
    dispatchWebhookEvent(s.organizationId, "payment.recorded", {
      id: payment.id,
      leaseId,
      amount,
      method,
      reference,
      paidAt: paidAt.toISOString(),
    }),
  );
  after(() => syncPayment(s.organizationId, payment.id));
  redirect(`/leases/${leaseId}`);
}

/**
 * Records one payment broken down across specific charges — "4,000 of this
 * is rent, 200 is water" — instead of leaving the whole amount to the
 * ordinary oldest-charge-first pool. Reads one `charge_<id>` field per
 * charge on the lease; only charges with a nonzero amount get an
 * allocation. Whatever of the total isn't itemized this way simply falls
 * into the pool like an ordinary payment (see allocate() in settle.ts) —
 * this never invents an allocation the office didn't actually enter.
 */
export async function recordDirectedPayment(leaseId: string, formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const lease = await prisma.lease.findFirst({ where: { id: leaseId, organizationId: s.organizationId } });
  if (!lease) throw new Error("Lease not found.");

  const amount = Number(formData.get("amount") ?? 0);
  const method = String(formData.get("method") ?? "").trim() || null;
  const reference = String(formData.get("reference") ?? "").trim() || null;
  const paidAt = new Date(String(formData.get("paidAt") ?? new Date().toISOString()));
  if (!amount) errorRedirect(`/leases/${leaseId}`, "Amount is required.");

  const charges = await prisma.charge.findMany({ where: { leaseId, organizationId: s.organizationId } });
  const allocations: { chargeId: string; amount: number }[] = [];
  let itemizedTotal = 0;
  for (const c of charges) {
    const raw = formData.get(`charge_${c.id}`);
    const amt = raw ? Number(raw) : 0;
    if (amt > 0) {
      allocations.push({ chargeId: c.id, amount: amt });
      itemizedTotal += amt;
    }
  }
  if (itemizedTotal > amount + 0.01) {
    errorRedirect(`/leases/${leaseId}`, "The itemized amounts add up to more than the total received.");
  }

  await prisma.payment.create({
    data: {
      organizationId: s.organizationId,
      leaseId,
      amount,
      method,
      reference,
      paidAt,
      allocations: {
        create: allocations.map((a) => ({ organizationId: s.organizationId, chargeId: a.chargeId, amount: a.amount })),
      },
    },
  });
  redirect(`/leases/${leaseId}`);
}

/**
 * Raises an approved month's rent charges across every active lease still
 * missing one — see app/lib/billing.ts for the rules. The period is
 * recomputed from scratch inside applyBilling rather than trusted from the
 * form, so nothing can be raised that the current state of the leases
 * doesn't actually call for.
 */
export async function runMonthlyBilling(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");
  requireFeature(await getOrgTier(s.organizationId), "BILLING_RUN");

  const period = String(formData.get("period") ?? "");
  if (!/^\d{4}-\d{2}$/.test(period)) errorRedirect("/leases/billing-run", "Select a valid month.");

  const result = await applyBilling(s.organizationId, period);
  redirect(`/leases/billing-run?period=${period}&billed=ok&leases=${result.leases}&charges=${result.charges}`);
}

// --- staff: evictions ------------------------------------------------------
// Kenyan-law eviction process: notice → optional distress for rent → suit →
// court order → enforcement. See app/lib/eviction.ts for the legal detail.
// Nothing here ends a tenancy except recordEnforced/recordVacated, and only
// once a lawful basis (a court order, or the tenant simply leaving) exists.

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const optStr = (fd: FormData, k: string) => str(fd, k) || null;

async function requireOwnedLease(organizationId: string, leaseId: string) {
  const lease = await prisma.lease.findFirst({ where: { id: leaseId, organizationId } });
  if (!lease) errorRedirect("/evictions", "Lease not found.");
  return lease;
}

async function requireOpenEviction(organizationId: string, id: string) {
  const ev = await prisma.eviction.findFirst({ where: { id, organizationId } });
  if (!ev) errorRedirect("/evictions", "Eviction case not found.");
  if (["ENFORCED", "WITHDRAWN", "VACATED"].includes(ev.status)) errorRedirect(`/evictions/${id}`, "This case is already closed.");
  return ev;
}

/** Opens a case. Nothing is served or filed yet — this is only the record of intent. */
export async function startEviction(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");
  requireFeature(await getOrgTier(s.organizationId), "EVICTIONS");

  const leaseId = str(formData, "leaseId");
  const lease = await requireOwnedLease(s.organizationId, leaseId);

  const existing = await prisma.eviction.findFirst({
    where: { leaseId, organizationId: s.organizationId, status: { notIn: ["ENFORCED", "WITHDRAWN", "VACATED"] } },
  });
  if (existing) errorRedirect(`/leases/${leaseId}`, "There is already an open eviction case for this lease.");

  const codes = GROUNDS_LIST.filter((g) => formData.get(`ground_${g}`) === "on");
  if (codes.length === 0) errorRedirect(`/leases/${leaseId}`, "Select at least one ground.");

  const ev = await prisma.eviction.create({
    data: {
      organizationId: s.organizationId,
      leaseId: lease.id,
      grounds: joinGrounds(codes),
      groundsDetail: optStr(formData, "groundsDetail"),
      status: "NOTICE_DRAFT",
    },
  });

  // Auto-serve by email/WhatsApp the instant the case opens — see
  // sendAndServeNotice's own comment for why this only advances the case
  // to NOTICE_SERVED on a genuine successful send, never as a guess. A
  // tenant with no contact details on file (or before email/WhatsApp is
  // configured) simply stays at NOTICE_DRAFT for staff to serve by hand.
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${h.get("host")}`;
  await sendAndServeNotice(s.organizationId, ev.id, origin);

  redirect(`/evictions/${ev.id}`);
}

/** Retries the automatic email/WhatsApp send — for a case still at NOTICE_DRAFT because the tenant had no contact details on file, or the provider wasn't configured yet when the case was opened. */
export async function resendNoticeAction(evictionId: string) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");
  await requireOpenEviction(s.organizationId, evictionId);

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${h.get("host")}`;
  const result = await sendAndServeNotice(s.organizationId, evictionId, origin);

  if (!result.sent) errorRedirect(`/evictions/${evictionId}`, result.reason);
  redirect(`/evictions/${evictionId}`);
}

/**
 * Step 1: the notice is served. The deadline is checked against the
 * statutory floor before it is written — a form's `min` attribute is advice
 * a browser can be talked out of; this is not.
 */
export async function recordNoticeServed(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const id = str(formData, "id");
  const ev = await requireOpenEviction(s.organizationId, id);

  const servedAt = new Date(str(formData, "servedAt"));
  const deadline = new Date(str(formData, "deadline"));
  if (isNaN(servedAt.getTime()) || isNaN(deadline.getTime())) errorRedirect(`/evictions/${id}`, "Served date and deadline are required.");
  if (!validNoticeDeadline(servedAt, deadline)) errorRedirect(`/evictions/${id}`, "The deadline must be at least 30 days after the served date.");

  await prisma.eviction.update({
    where: { id: ev.id },
    data: {
      status: "NOTICE_SERVED",
      noticeServedAt: servedAt,
      noticeDeliveryMethod: str(formData, "deliveryMethod") || "HAND_DELIVERED",
      noticeDeadline: deadline,
    },
  });
  redirect(`/evictions/${id}`);
}

export async function recordDistressFiled(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const id = str(formData, "id");
  const ev = await requireOpenEviction(s.organizationId, id);

  const filedAtStr = str(formData, "filedAt");
  const filedAt = filedAtStr ? new Date(filedAtStr) : new Date();
  await prisma.eviction.update({
    where: { id: ev.id },
    data: {
      status: "DISTRESS_FILED",
      distressFiledAt: filedAt,
      auctioneerName: optStr(formData, "auctioneerName"),
      proclamationEnds: new Date(filedAt.getTime() + 14 * 864e5),
    },
  });
  redirect(`/evictions/${id}`);
}

export async function recordCourtFiled(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const id = str(formData, "id");
  const ev = await requireOpenEviction(s.organizationId, id);

  const courtVenue = str(formData, "courtVenue");
  if (!["RRT", "MAGISTRATE", "ELC"].includes(courtVenue)) errorRedirect(`/evictions/${id}`, "Select a valid venue.");

  const filedAtStr = str(formData, "filedAt");
  await prisma.eviction.update({
    where: { id: ev.id },
    data: {
      status: "COURT_FILED",
      courtFiledAt: filedAtStr ? new Date(filedAtStr) : new Date(),
      courtVenue,
      caseNumber: optStr(formData, "caseNumber"),
    },
  });
  redirect(`/evictions/${id}`);
}

/** Step 4: the court's own order. Nothing downstream may happen without this. */
export async function recordOrderObtained(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const id = str(formData, "id");
  const ev = await requireOpenEviction(s.organizationId, id);

  const vacateByStr = str(formData, "vacateBy");
  const vacateBy = new Date(vacateByStr);
  if (isNaN(vacateBy.getTime())) errorRedirect(`/evictions/${id}`, "A vacant-possession date is required.");

  const obtainedAtStr = str(formData, "obtainedAt");
  await prisma.eviction.update({
    where: { id: ev.id },
    data: {
      status: "ORDER_OBTAINED",
      orderObtainedAt: obtainedAtStr ? new Date(obtainedAtStr) : new Date(),
      orderVacateBy: vacateBy,
    },
  });
  redirect(`/evictions/${id}`);
}

/** The one thing both a forced removal and a voluntary exit have in common. */
async function endTenancy(leaseId: string) {
  await prisma.lease.update({ where: { id: leaseId }, data: { status: "ENDED", endDate: new Date() } });
}

/**
 * Step 5: carried out. This is the only step that touches the tenancy
 * itself — it ends the lease — and only an organization admin may take it,
 * gated behind an order already being on record.
 */
export async function recordEnforced(formData: FormData) {
  const s = await getSession();
  if (!requireOrgAdmin(s)) throw new Error("Only an organization admin can record an eviction as enforced.");

  const id = str(formData, "id");
  const ev = await requireOpenEviction(s.organizationId, id);
  if (!ev.orderObtainedAt) errorRedirect(`/evictions/${id}`, "An eviction order must be on record before this can be enforced.");

  await prisma.eviction.update({
    where: { id: ev.id },
    data: {
      status: "ENFORCED",
      enforcedAt: new Date(),
      bailiffName: optStr(formData, "bailiffName"),
      policePresent: formData.get("policePresent") === "on",
    },
  });
  await endTenancy(ev.leaseId);
  redirect(`/evictions/${id}`);
}

/**
 * The tenant complies and leaves on their own — the most common way a case
 * actually ends. Reachable from any open stage, not only after an order.
 * Any staff member may record it, not only an admin, since nothing about it
 * is irreversible the way enforcement is — it is simply what happened.
 */
export async function recordVacated(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const id = str(formData, "id");
  const ev = await requireOpenEviction(s.organizationId, id);

  const vacatedAtStr = str(formData, "vacatedAt");
  await prisma.eviction.update({
    where: { id: ev.id },
    data: { status: "VACATED", vacatedAt: vacatedAtStr ? new Date(vacatedAtStr) : new Date() },
  });
  await endTenancy(ev.leaseId);
  redirect(`/evictions/${id}`);
}

export async function withdrawEviction(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const id = str(formData, "id");
  const ev = await requireOpenEviction(s.organizationId, id);

  await prisma.eviction.update({
    where: { id: ev.id },
    data: { status: "WITHDRAWN", withdrawnAt: new Date(), withdrawnReason: optStr(formData, "reason") },
  });
  redirect(`/evictions/${id}`);
}

// --- staff: expenses ------------------------------------------------------
// The landlord's own money going out. Every expense entered here — other
// than one posted automatically from a completed repair, see
// markRepairDone — goes through the same multi-signature approval chain as
// a repair cost: nothing is written to the Expense table until the chain
// resolves (see PAYMENT_OUT in app/lib/approvals.ts).

export async function createExpense(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");
  requireFeature(await getOrgTier(s.organizationId), "EXPENSES");

  const category = str(formData, "category");
  const amount = Number(formData.get("amount") ?? 0);
  const paidAt = str(formData, "paidAt") || new Date().toISOString().slice(0, 10);
  if (!category || !amount || amount <= 0) errorRedirect("/expenses", "Category and a positive amount are required.");

  const propertyId = optStr(formData, "propertyId");
  if (propertyId) {
    const property = await prisma.property.findFirst({ where: { id: propertyId, organizationId: s.organizationId } });
    if (!property) errorRedirect("/expenses", "Property not found.");
  }

  await raiseApproval(s.organizationId, "PAYMENT_OUT", `new:${s.userId}:${Date.now()}`, s.userId, {
    organizationId: s.organizationId,
    raisedById: s.userId,
    category,
    amount,
    paidAt,
    description: optStr(formData, "description"),
    payee: optStr(formData, "payee"),
    method: optStr(formData, "method"),
    reference: optStr(formData, "reference"),
    propertyId,
  });
  redirect("/approvals");
}

export async function deleteExpense(expenseId: string) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const expense = await prisma.expense.findFirst({ where: { id: expenseId, organizationId: s.organizationId } });
  if (!expense) errorRedirect("/expenses", "Expense not found.");
  if (expense.repairId) errorRedirect("/expenses", "This expense was posted from a repair — edit the repair's final cost instead.");

  await prisma.expense.delete({ where: { id: expenseId } });
  redirect("/expenses");
}

// --- staff: vendors / repairs --------------------------------------------

export async function createVendor(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");
  requireFeature(await getOrgTier(s.organizationId), "REPAIRS");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) errorRedirect("/vendors/new", "Vendor name is required.");

  await prisma.vendor.create({
    data: {
      organizationId: s.organizationId,
      name,
      trade: String(formData.get("trade") ?? "").trim() || null,
      contactName: String(formData.get("contactName") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      email: String(formData.get("email") ?? "").trim() || null,
      // Prequalification is an office decision, made explicitly here — never
      // inferred from a checkbox a vendor could tick on their own.
      prequalified: formData.get("prequalified") === "on",
    },
  });
  redirect("/vendors");
}

export async function setVendorPrequalified(vendorId: string, prequalified: boolean) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");
  const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, organizationId: s.organizationId } });
  if (!vendor) throw new Error("Vendor not found.");
  await prisma.vendor.update({ where: { id: vendorId }, data: { prequalified } });
}

export async function updateVendor(vendorId: string, formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");
  const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, organizationId: s.organizationId } });
  if (!vendor) errorRedirect("/vendors", "Vendor not found.");

  const name = str(formData, "name");
  if (!name) errorRedirect(`/vendors/${vendorId}/edit`, "Vendor name is required.");

  await prisma.vendor.update({
    where: { id: vendorId },
    data: {
      name,
      trade: optStr(formData, "trade"),
      contactName: optStr(formData, "contactName"),
      phone: optStr(formData, "phone"),
      email: optStr(formData, "email"),
      notes: optStr(formData, "notes"),
    },
  });
  redirect(`/vendors/${vendorId}`);
}

export async function deleteVendor(vendorId: string) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");
  const vendor = await prisma.vendor.findFirst({
    where: { id: vendorId, organizationId: s.organizationId },
    include: { quotes: true, user: true },
  });
  if (!vendor) throw new Error("Vendor not found.");
  if (vendor.quotes.length > 0) errorRedirect(`/vendors/${vendorId}`, "This vendor has quote history on file — leave them on record rather than deleting.");
  if (vendor.user) errorRedirect(`/vendors/${vendorId}`, "This vendor has portal access — disable it before deleting.");

  await prisma.repair.updateMany({ where: { awardedVendorId: vendorId, organizationId: s.organizationId }, data: { awardedVendorId: null } });
  await prisma.recurringJob.updateMany({ where: { vendorId, organizationId: s.organizationId }, data: { vendorId: null } });
  await prisma.vendor.delete({ where: { id: vendorId } });
  redirect("/vendors");
}

// --- staff: suppliers -------------------------------------------------------
// Where materials for a repair were bought — distinct from Vendor, who is
// paid for labour. See app/lib/tier.ts — bundled with Repairs, same package.

export async function createSupplier(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");
  requireFeature(await getOrgTier(s.organizationId), "SUPPLIERS");

  const name = str(formData, "name");
  if (!name) errorRedirect("/suppliers", "Supplier name is required.");

  await prisma.supplier.create({
    data: {
      organizationId: s.organizationId,
      name,
      category: str(formData, "category") || "GENERAL",
      itemDescription: optStr(formData, "itemDescription"),
      itemPrice: formData.get("itemPrice") ? Number(formData.get("itemPrice")) : null,
      contactName: optStr(formData, "contactName"),
      phone: optStr(formData, "phone"),
      email: optStr(formData, "email"),
      notes: optStr(formData, "notes"),
    },
  });
  redirect("/suppliers");
}

export async function updateSupplier(supplierId: string, formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, organizationId: s.organizationId } });
  if (!supplier) errorRedirect("/suppliers", "Supplier not found.");

  const name = str(formData, "name");
  if (!name) errorRedirect(`/suppliers/${supplierId}/edit`, "Supplier name is required.");

  await prisma.supplier.update({
    where: { id: supplierId },
    data: {
      name,
      category: str(formData, "category") || "GENERAL",
      itemDescription: optStr(formData, "itemDescription"),
      itemPrice: formData.get("itemPrice") ? Number(formData.get("itemPrice")) : null,
      contactName: optStr(formData, "contactName"),
      phone: optStr(formData, "phone"),
      email: optStr(formData, "email"),
      notes: optStr(formData, "notes"),
    },
  });
  redirect(`/suppliers/${supplierId}`);
}

export async function deleteSupplier(supplierId: string) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, organizationId: s.organizationId } });
  if (!supplier) throw new Error("Supplier not found.");

  // Repairs that named this supplier keep their history and simply lose the
  // assignment, the same treatment a removed vendor gets.
  await prisma.repair.updateMany({ where: { supplierId, organizationId: s.organizationId }, data: { supplierId: null } });
  await prisma.supplier.delete({ where: { id: supplierId } });
  redirect("/suppliers");
}

/** Naming, or clearing, which supplier a repair's materials came from. */
export async function assignSupplier(repairId: string, formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const repair = await prisma.repair.findFirst({ where: { id: repairId, organizationId: s.organizationId } });
  if (!repair) throw new Error("Repair not found.");

  const supplierId = optStr(formData, "supplierId");
  if (supplierId) {
    const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, organizationId: s.organizationId } });
    if (!supplier) throw new Error("Supplier not found.");
  }

  await prisma.repair.update({ where: { id: repairId }, data: { supplierId } });
  redirect(`/repairs/${repairId}`);
}

export async function createRepair(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");
  requireFeature(await getOrgTier(s.organizationId), "REPAIRS");

  const propertyId = String(formData.get("propertyId") ?? "");
  const unitId = String(formData.get("unitId") ?? "").trim() || null;
  const title = String(formData.get("title") ?? "").trim();
  if (!propertyId || !title) errorRedirect("/repairs/new", "Property and title are required.");

  const property = await prisma.property.findFirst({ where: { id: propertyId, organizationId: s.organizationId } });
  if (!property) errorRedirect("/repairs/new", "Property not found.");
  if (unitId) {
    const unit = await prisma.unit.findFirst({ where: { id: unitId, organizationId: s.organizationId, propertyId } });
    if (!unit) errorRedirect("/repairs/new", "Unit not found on that property.");
  }

  await prisma.repair.create({
    data: {
      organizationId: s.organizationId,
      propertyId,
      unitId,
      title,
      description: String(formData.get("description") ?? "").trim() || null,
      category: String(formData.get("category") ?? "").trim() || null,
      priority: String(formData.get("priority") ?? "NORMAL"),
    },
  });
  redirect("/repairs");
}

async function requireOwnedRepair(organizationId: string, repairId: string) {
  const repair = await prisma.repair.findFirst({ where: { id: repairId, organizationId } });
  if (!repair) errorRedirect("/repairs", "Repair not found.");
  return repair;
}

export async function sendWorkOrder(repairId: string, formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");
  await requireOwnedRepair(s.organizationId, repairId);

  const workOrderRef = String(formData.get("workOrderRef") ?? "").trim() || null;
  await prisma.repair.update({
    where: { id: repairId },
    data: { status: "QUOTING", workOrderSentAt: new Date(), workOrderRef },
  });
  redirect(`/repairs/${repairId}`);
}

export async function submitQuote(repairId: string, formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");
  await requireOwnedRepair(s.organizationId, repairId);

  const vendorId = String(formData.get("vendorId") ?? "");
  const amount = Number(formData.get("amount") ?? 0);
  if (!vendorId || !amount) errorRedirect(`/repairs/${repairId}`, "Vendor and amount are required.");

  const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, organizationId: s.organizationId } });
  if (!vendor) errorRedirect(`/repairs/${repairId}`, "Vendor not found.");

  await prisma.quote.upsert({
    where: { repairId_vendorId: { repairId, vendorId } },
    create: {
      organizationId: s.organizationId,
      repairId,
      vendorId,
      amount,
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
    update: { amount, notes: String(formData.get("notes") ?? "").trim() || null },
  });
  redirect(`/repairs/${repairId}`);
}

/**
 * Awarding a quote is a financial commitment, so it goes through the
 * approval chain rather than applying immediately — the raiser supplies the
 * first signature, and the award only takes effect once the chain resolves
 * (see app/lib/approvals.ts).
 */
export async function acceptQuote(repairId: string, quoteId: string) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");
  await requireOwnedRepair(s.organizationId, repairId);

  const quote = await prisma.quote.findFirst({ where: { id: quoteId, repairId, organizationId: s.organizationId } });
  if (!quote) errorRedirect(`/repairs/${repairId}`, "Quote not found.");

  await raiseApproval(s.organizationId, "QUOTE_AWARD", repairId, s.userId, { quoteId });
}

/** Gate 1: authorises the work to proceed. Raises the approval chain rather than applying directly. */
export async function approveWork(repairId: string) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");
  await requireOwnedRepair(s.organizationId, repairId);

  await raiseApproval(s.organizationId, "REPAIR_WORK", repairId, s.userId);
}

/** Gate 2: authorises the price ceiling. Requires work to already be approved. */
export async function approveCost(repairId: string, formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");
  const repair = await requireOwnedRepair(s.organizationId, repairId);
  if (!repair.workApprovedAt) errorRedirect(`/repairs/${repairId}`, "Work must be approved before cost can be approved.");

  const approvedCost = Number(formData.get("approvedCost") ?? 0);
  if (!approvedCost) errorRedirect(`/repairs/${repairId}`, "Approved cost is required.");

  await raiseApproval(s.organizationId, "REPAIR_COST", repairId, s.userId, { approvedCost });
}

/** Adds the caller's signature to a pending approval request. */
export async function signApprovalAction(requestId: string) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");
  await signApproval(s.organizationId, requestId, s.userId);
}

export async function markRepairDone(repairId: string, formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");
  const repair = await requireOwnedRepair(s.organizationId, repairId);
  if (!repair.costApprovedAt) errorRedirect(`/repairs/${repairId}`, "Cost must be approved before a repair can be marked done.");

  const finalCost = Number(formData.get("finalCost") ?? repair.approvedCost ?? 0);
  await prisma.repair.update({
    where: { id: repairId },
    data: { status: "DONE", completedAt: new Date(), finalCost },
  });
  await postRepairExpense(s.organizationId, repairId, s.userId);
}

// --- staff: recurring jobs -------------------------------------------------
// A vendor job whose cost and frequency are already agreed — cleaning being
// the first of these — so it doesn't go through quoting or approval every
// time it falls due. The daily cron (app/api/cron/daily) raises it already
// DONE and posts its cost straight to Expenses. See app/lib/tier.ts — this
// is a FULL-package feature.

export async function createRecurringJob(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");
  requireFeature(await getOrgTier(s.organizationId), "RECURRING_JOBS");

  const title = str(formData, "title");
  const propertyId = str(formData, "propertyId");
  const cost = Number(formData.get("cost") ?? 0);
  const frequencyDays = Number(formData.get("frequencyDays") ?? 0);
  if (!title || !propertyId || cost <= 0 || frequencyDays <= 0) {
    errorRedirect("/repairs", "Fill in the job, property, cost, and frequency.");
  }

  const property = await prisma.property.findFirst({ where: { id: propertyId, organizationId: s.organizationId } });
  if (!property) errorRedirect("/repairs", "Property not found.");

  const vendorId = optStr(formData, "vendorId");
  if (vendorId) {
    const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, organizationId: s.organizationId } });
    if (!vendor) errorRedirect("/repairs", "Vendor not found.");
  }

  await prisma.recurringJob.create({
    data: {
      organizationId: s.organizationId,
      propertyId,
      vendorId,
      title,
      category: str(formData, "category") || "CLEANING",
      cost,
      frequencyDays,
      // Starts the clock today, not backdated — the office adds this once
      // the job is already happening, not from whenever it first began.
      nextDueAt: new Date(),
    },
  });
  redirect("/repairs");
}

export async function setRecurringJobActive(jobId: string, active: boolean) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const job = await prisma.recurringJob.findFirst({ where: { id: jobId, organizationId: s.organizationId } });
  if (!job) throw new Error("Recurring job not found.");
  await prisma.recurringJob.update({ where: { id: jobId }, data: { active } });
}

export async function deleteRecurringJob(jobId: string) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const job = await prisma.recurringJob.findFirst({ where: { id: jobId, organizationId: s.organizationId } });
  if (!job) throw new Error("Recurring job not found.");
  await prisma.recurringJob.delete({ where: { id: jobId } });
  redirect("/repairs");
}

// --- staff: outside-role invitations --------------------------------------

export async function inviteTenant(tenantId: string) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, organizationId: s.organizationId } });
  if (!tenant) errorRedirect("/tenants", "Tenant not found.");
  if (!tenant.email && !tenant.phone) errorRedirect(`/tenants/${tenantId}`, "Tenant needs an email or phone on file before inviting.");

  const invite = await createInvitation(
    s.organizationId,
    "TENANT",
    { tenantId },
    { email: tenant.email ?? undefined, phone: tenant.phone ?? undefined },
  );
  redirect(inviteRedirectUrl(invite));
}

/**
 * Invites someone who isn't a tenant on file yet — a prospect, not someone
 * already housed in a unit. Creates the Tenant record and the invitation in
 * one step, since asking staff to "add tenant" then separately "invite" for
 * what is really one action (bringing on a new person) is friction with no
 * payoff. The tenant still isn't attached to any lease — that happens
 * normally, once they've actually moved in.
 */
export async function inviteNewTenant(formData: FormData) {
  const s = await getSession();
  if (!requireTenantsAccess(s)) throw new Error("Not authorized.");

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;
  if (!name) errorRedirect("/tenants", "Name is required.");
  if (!phone && !email) errorRedirect("/tenants", "Enter a phone number or email to invite a new tenant.");

  // A caretaker works one property, never the whole org — tag the tenant
  // with it now, since there's no lease yet to scope by later.
  const propertyId = isCaretaker(s.role) ? s.propertyId : null;
  const tenant = await prisma.tenant.create({
    data: { organizationId: s.organizationId, propertyId, name, phone, email },
  });

  const invite = await createInvitation(
    s.organizationId,
    "TENANT",
    { tenantId: tenant.id },
    { email: email ?? undefined, phone: phone ?? undefined },
  );
  redirect(inviteRedirectUrl(invite));
}

export async function inviteVendor(vendorId: string, formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, organizationId: s.organizationId } });
  if (!vendor) errorRedirect("/vendors", "Vendor not found.");
  if (!vendor.email && !vendor.phone) errorRedirect(`/vendors/${vendorId}`, "Vendor needs an email or phone on file before inviting.");

  const workerType = String(formData.get("workerType") ?? "TRADESMAN");
  if (workerType !== "TRADESMAN" && workerType !== "CASUAL_LABOURER") errorRedirect(`/vendors/${vendorId}`, "Invalid role.");

  const invite = await createInvitation(
    s.organizationId,
    workerType,
    { vendorId },
    { email: vendor.email ?? undefined, phone: vendor.phone ?? undefined },
  );
  redirect(inviteRedirectUrl(invite));
}

/**
 * Invites someone to caretake one property — the only module their account
 * will ever see is Tenants (see requireTenantsAccess), so nothing else about
 * this org is exposed by handing out this invite.
 */
export async function inviteCaretaker(propertyId: string, formData: FormData) {
  const s = await getSession();
  if (!requireOrgAdmin(s)) throw new Error("Not authorized.");

  const property = await prisma.property.findFirst({ where: { id: propertyId, organizationId: s.organizationId } });
  if (!property) throw new Error("Property not found.");

  const email = String(formData.get("email") ?? "").trim() || undefined;
  const phone = String(formData.get("phone") ?? "").trim() || undefined;
  if (!email && !phone) errorRedirect(`/properties/${propertyId}`, "Enter a phone number or email to invite a caretaker.");

  const invite = await createInvitation(s.organizationId, "CARETAKER", { propertyId }, { email, phone });
  redirect(inviteRedirectUrl(invite));
}

// --- public: registration --------------------------------------------------

export async function registerWithInvite(formData: FormData) {
  const code = String(formData.get("code") ?? "");
  const identifier = String(formData.get("identifier") ?? "");
  const password = String(formData.get("password") ?? "");
  const consented = formData.get("consent") === "on";
  if (!code || !identifier || !password) errorRedirect("/register", "Code, email/phone, and password are all required.");

  // Same lockout machinery as login, keyed on the code itself rather than an
  // identifier — a wrong-guess run against one code locks out further
  // guesses at that code specifically, without touching anyone else's.
  const lock = await checkLock(`invite:${code}`);
  if (lock.locked) errorRedirect("/register", `Too many attempts. Try again in ${lock.minutesLeft} minute(s).`);

  const result = await redeemInvitation(code, identifier, password, consented);
  if (!result.ok) {
    await recordFailure(`invite:${code}`);
    errorRedirect("/register", result.error);
  }
  await clearFailures(`invite:${code}`);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
  await createSession({
    id: user.id,
    organizationId: user.organizationId,
    email: user.email,
    phone: user.phone,
    role: user.role,
  });

  redirect(
    result.role === "TENANT"
      ? "/portal"
      : result.role === "MANAGER" || result.role === "VIEWER"
        ? "/dashboard"
        : result.role === "CARETAKER"
          ? "/tenants"
          : "/trade",
  );
}

// --- staff: payments ingestion ---------------------------------------------

export async function setUnitPaymentCode(unitId: string, formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const unit = await prisma.unit.findFirst({ where: { id: unitId, organizationId: s.organizationId } });
  if (!unit) throw new Error("Unit not found.");

  const paymentCode = String(formData.get("paymentCode") ?? "").trim() || null;
  await prisma.unit.update({ where: { id: unitId }, data: { paymentCode } });
}

export async function addManualTransaction(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const amount = Number(formData.get("amount") ?? 0);
  const occurredAt = new Date(String(formData.get("occurredAt") ?? ""));
  if (!amount || isNaN(occurredAt.getTime())) errorRedirect("/payments", "Amount and date are required.");

  await ingestTransaction({
    organizationId: s.organizationId,
    source: "MANUAL",
    amount,
    reference: String(formData.get("reference") ?? "").trim() || null,
    payerName: String(formData.get("payerName") ?? "").trim() || null,
    occurredAt,
  });
  redirect("/payments");
}

export async function importTransactionsCsv(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const file = formData.get("file");
  if (!(file instanceof File)) errorRedirect("/payments", "Choose a CSV file.");
  const text = await file.text();
  const rows = parseTransactionsCsv(text);
  if (rows.length === 0) errorRedirect("/payments", "No valid rows found — expected date,amount,reference,payer per line.");

  for (const row of rows) {
    await ingestTransaction({ organizationId: s.organizationId, source: "CSV_IMPORT", ...row });
  }
  redirect("/payments");
}

export async function matchTransactionAction(transactionId: string, formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const leaseId = String(formData.get("leaseId") ?? "");
  if (!leaseId) errorRedirect("/payments", "Select a lease to match this transaction to.");

  await matchTransaction(s.organizationId, transactionId, leaseId, s.userId);
}

export async function ignoreTransactionAction(transactionId: string) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");
  await ignoreTransaction(s.organizationId, transactionId, s.userId);
}

// --- staff: team management -------------------------------------------

/**
 * Invites a teammate as VIEWER by default — least-privilege by construction.
 * The admin explicitly upgrades to MANAGER via `setStaffRole` afterward,
 * rather than every invite defaulting to broad access and someone having to
 * remember to narrow it.
 */
export async function inviteStaff(formData: FormData) {
  const s = await getSession();
  if (!requireOrgAdmin(s)) throw new Error("Only an organization admin can invite staff.");

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim();
  const role = String(formData.get("role") ?? "VIEWER");

  // A caretaker is scoped to one property, not a staff seat on the wider
  // org — kept out of the seat-limited MANAGER/VIEWER count below, same as
  // inviteCaretaker() on the property page (which this replaces as the only
  // way to invite one — that page-level form was hard to find). Email isn't
  // in common use among caretakers, so — unlike MANAGER/VIEWER below — a
  // phone number alone is enough, same as a tenant invite.
  if (role === "CARETAKER") {
    if (!email && !phone) errorRedirect("/users", "Enter a phone number or email for the caretaker.");
    const propertyId = String(formData.get("propertyId") ?? "");
    if (!propertyId) errorRedirect("/users", "Select a property for the caretaker.");
    const property = await prisma.property.findFirst({ where: { id: propertyId, organizationId: s.organizationId } });
    if (!property) errorRedirect("/users", "Property not found.");
    const invite = await createInvitation(
      s.organizationId,
      "CARETAKER",
      { propertyId },
      { email: email || undefined, phone: phone || undefined },
    );
    redirect(inviteRedirectUrl(invite));
  }

  if (!email) errorRedirect("/users", "Email is required.");
  if (role !== "MANAGER" && role !== "VIEWER") errorRedirect("/users", "Invalid role.");

  const limit = staffSeatLimit(await getOrgTier(s.organizationId));
  if (limit !== null) {
    const seats = await prisma.user.count({
      where: { organizationId: s.organizationId, role: { in: ["ADMIN", "MANAGER", "VIEWER"] }, disabledAt: null },
    });
    if (seats >= limit) {
      errorRedirect("/users", `Your plan is limited to ${limit} staff seat${limit === 1 ? "" : "s"} — upgrade to add teammates.`);
    }
  }

  const invite = await createInvitation(s.organizationId, role, {}, { email });
  redirect(inviteRedirectUrl(invite));
}

/** Promotes/demotes between MANAGER and VIEWER. Never targets ADMIN — that seat is fixed at org creation. */
export async function setStaffRole(userId: string, role: "MANAGER" | "VIEWER") {
  const s = await getSession();
  if (!requireOrgAdmin(s)) throw new Error("Only an organization admin can change staff roles.");

  const user = await prisma.user.findFirst({ where: { id: userId, organizationId: s.organizationId } });
  if (!user) errorRedirect("/users", "Not found.");
  if (user.role === "ADMIN") errorRedirect("/users", "Cannot change the admin's role.");

  await prisma.user.update({ where: { id: userId }, data: { role } });
}

/** Revokes access without deleting the account — history stays attached to a real row. Every session is signed out immediately. */
export async function disableStaff(userId: string) {
  const s = await getSession();
  if (!requireOrgAdmin(s)) throw new Error("Only an organization admin can disable staff.");

  const user = await prisma.user.findFirst({ where: { id: userId, organizationId: s.organizationId } });
  if (!user) errorRedirect("/users", "Not found.");
  if (user.role === "ADMIN") errorRedirect("/users", "Cannot disable the admin.");

  await prisma.user.update({ where: { id: userId }, data: { disabledAt: new Date() } });
  await revokeAllSessions(userId);
}

export async function enableStaff(userId: string) {
  const s = await getSession();
  if (!requireOrgAdmin(s)) throw new Error("Only an organization admin can restore staff access.");

  const user = await prisma.user.findFirst({ where: { id: userId, organizationId: s.organizationId } });
  if (!user) throw new Error("Not found.");

  await prisma.user.update({ where: { id: userId }, data: { disabledAt: null } });
}

/**
 * A hard delete, not another disable — for a teammate who should never have
 * been added, as opposed to one whose access should simply stop. Blocked
 * when the user has ever signed an approval: ApprovalStep is append-only
 * history (see its schema comment) and has no cascade on User, so removing
 * a signer would either break that record or silently rewrite what actually
 * happened — disabling is the correct tool for that case instead.
 */
export async function deleteStaffAction(userId: string) {
  const s = await getSession();
  if (!requireOrgAdmin(s)) throw new Error("Only an organization admin can delete a teammate.");

  const user = await prisma.user.findFirst({ where: { id: userId, organizationId: s.organizationId } });
  if (!user) throw new Error("Not found.");
  if (user.role === "ADMIN") errorRedirect("/users", "Cannot delete the admin.");
  if (userId === s.userId) errorRedirect("/users", "You cannot delete your own account.");

  const approvalSteps = await prisma.approvalStep.count({ where: { userId } });
  if (approvalSteps > 0) {
    errorRedirect("/users", "This teammate has signed approvals on file and can't be deleted — disable their access instead.");
  }

  await prisma.user.delete({ where: { id: userId } });
  redirect("/users");
}

/** Cancels an invite before it's used — the email/phone/code stop working immediately. Never touches a redeemed one; that's a fact of what happened, not left in a "pending" state to clean up. */
export async function revokeInvitationAction(invitationId: string) {
  const s = await getSession();
  if (!requireOrgAdmin(s)) throw new Error("Only an organization admin can revoke an invitation.");

  await prisma.invitation.deleteMany({ where: { id: invitationId, organizationId: s.organizationId, usedAt: null } });
  redirect("/users");
}

// --- staff: impersonation ------------------------------------------------

/** Opens a session as another user in the same organization — see app/lib/auth.ts `impersonate()` for the rules. */
export async function impersonateAction(targetUserId: string) {
  const s = await getSession();
  if (!requireOrgAdmin(s)) throw new Error("Only an organization admin can sign in as someone else.");
  await impersonate(s, targetUserId);
  redirect("/dashboard");
}

/**
 * A platform admin opening a session as an org's own staff — for support
 * that needs actual edit/delete access to a customer's data, through their
 * real UI rather than a duplicate set of platform-side forms. See
 * platformImpersonate() in app/lib/auth.ts for why this is allowed to cross
 * organizations and reach the org's own ADMIN seat. Logged unconditionally,
 * on the same footing as viewing an org's data.
 */
export async function platformImpersonateAction(targetUserId: string) {
  const s = await getSession();
  if (!requirePlatformAdmin(s)) throw new Error("Not authorized.");
  const organizationId = await platformImpersonate(s, targetUserId);
  await logPlatformAccess(s.userId, organizationId, "IMPERSONATE_ORG", `Signed in as staff by ${s.email ?? s.userId}`);
  redirect("/dashboard");
}

/** Hands the session back to whoever opened it — a platform admin returns to the org list, an org admin to their own team page. */
export async function endImpersonationAction() {
  await endImpersonation();
  const s = await getSession();
  redirect(s && requirePlatformAdmin(s) ? "/platform" : "/users");
}

// --- account: session management -----------------------------------------

export async function revokeSessionAction(formData: FormData) {
  const s = await getSession();
  if (!s) throw new Error("Not authorized.");
  const sessionId = String(formData.get("sessionId") ?? "");
  if (sessionId) await revokeSession(s.userId, sessionId);
}

export async function revokeOtherSessionsAction() {
  const s = await getSession();
  if (!s) throw new Error("Not authorized.");
  await revokeOtherSessions(s.userId);
}

/** An org admin signing a teammate out of one specific device — support for "someone left a shared computer logged in," not something the teammate does to themselves (that's revokeSessionAction above, scoped to your own account). */
export async function revokeTeammateSessionAction(userId: string, sessionId: string) {
  const s = await getSession();
  if (!requireOrgAdmin(s)) throw new Error("Only an organization admin can manage a teammate's sessions.");

  const user = await prisma.user.findFirst({ where: { id: userId, organizationId: s.organizationId } });
  if (!user) throw new Error("Not found.");

  await prisma.session.updateMany({ where: { id: sessionId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
  redirect(`/users/${userId}/sessions`);
}

export async function revokeAllTeammateSessionsAction(userId: string) {
  const s = await getSession();
  if (!requireOrgAdmin(s)) throw new Error("Only an organization admin can manage a teammate's sessions.");

  const user = await prisma.user.findFirst({ where: { id: userId, organizationId: s.organizationId } });
  if (!user) throw new Error("Not found.");

  await revokeAllSessions(userId);
  redirect(`/users/${userId}/sessions`);
}

// --- tenant: sign lease ----------------------------------------------------

/**
 * Records the tenant's own e-signature against their own lease. Only ever
 * their own — leaseId comes from the form, but the where-clause below
 * filters on the session's tenantId too, so a tampered leaseId just
 * matches nothing rather than reaching someone else's tenancy.
 */
export async function signLease(leaseId: string, formData: FormData) {
  const s = await getSession();
  if (!requireTenant(s)) throw new Error("Not authorized.");

  const signatureImage = String(formData.get("signatureImage") ?? "");
  const signedByName = String(formData.get("signedByName") ?? "").trim();
  if (!signatureImage.startsWith("data:image/png;base64,")) errorRedirect("/portal", "Please draw your signature first.");
  if (!signedByName) errorRedirect("/portal", "Enter the name you're signing as.");

  const lease = await prisma.lease.findFirst({
    where: { id: leaseId, organizationId: s.organizationId, tenantId: s.tenantId },
    include: { tenant: true, unit: { include: { property: true } } },
  });
  if (!lease) errorRedirect("/portal", "Lease not found.");
  if (lease.signedAt) errorRedirect("/portal", "This lease has already been signed.");

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = h.get("user-agent");

  await prisma.lease.update({
    where: { id: leaseId },
    data: {
      signatureImage,
      signedAt: new Date(),
      signedByName,
      signedIp: ip,
      signedUserAgent: userAgent,
    },
  });

  // The office isn't watching every lease for a signature to land, so the
  // moment one does, it's dropped into the same thread staff already check
  // for tenant messages — no email/SMS provider configured to push it any
  // further than that yet, but nothing here silently goes unnoticed.
  await prisma.message.create({
    data: {
      organizationId: s.organizationId,
      tenantId: lease.tenant.id,
      body: `Signed the tenancy agreement for ${lease.unit.property.name}, unit ${lease.unit.label}, as ${signedByName}.`,
      fromTenant: true,
      authorName: lease.tenant.name,
    },
  });

  after(() =>
    dispatchWebhookEvent(s.organizationId, "lease.signed", {
      id: lease.id,
      tenant: lease.tenant.name,
      property: lease.unit.property.name,
      unit: lease.unit.label,
      signedByName,
      signedAt: new Date().toISOString(),
    }),
  );
}

// --- messages ---------------------------------------------------------------
// One thread per tenant, office and tenant writing into the same list.

/** The tenant's own line in their thread with the office. */
export async function sendTenantMessage(formData: FormData) {
  const s = await getSession();
  if (!requireTenant(s)) throw new Error("Not authorized.");

  const body = sanitizeMessageBody(String(formData.get("body") ?? ""));
  if (!body) errorRedirect("/portal", "Write a message first.");
  if (body.length > 4000) errorRedirect("/portal", "Please keep it shorter.");

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: s.tenantId! } });
  const message = await prisma.message.create({
    data: { organizationId: s.organizationId, tenantId: tenant.id, body, fromTenant: true, authorName: tenant.name },
  });
  const uploadErrors = await attachFilesToMessage(s.organizationId, message.id, formData);
  if (uploadErrors.length > 0) {
    errorRedirect("/portal", uploadErrors.map((e) => `${e.file}: ${e.reason}`).join(" "));
  }
  redirect("/portal");
}

/** The office replying in a tenant's thread — never a tenant's own session. */
export async function replyToTenant(tenantId: string, formData: FormData) {
  const s = await getSession();
  if (!requireTenantsAccess(s)) throw new Error("Not authorized.");

  const propertyId = isCaretaker(s.role) ? s.propertyId : null;
  const tenant = await prisma.tenant.findFirst({
    where: {
      id: tenantId,
      organizationId: s.organizationId,
      ...(propertyId ? { OR: [{ propertyId }, { leases: { some: { unit: { propertyId } } } }] } : {}),
    },
  });
  if (!tenant) errorRedirect("/tenants", "Tenant not found.");

  const body = sanitizeMessageBody(String(formData.get("body") ?? "")).slice(0, 4000);
  if (!body) errorRedirect(`/tenants/${tenantId}`, "Write a message first.");

  const message = await prisma.message.create({
    data: {
      organizationId: s.organizationId,
      tenantId,
      body,
      fromTenant: false,
      authorName: s.email ?? s.phone ?? "Staff",
    },
  });
  const uploadErrors = await attachFilesToMessage(s.organizationId, message.id, formData);
  if (uploadErrors.length > 0) {
    errorRedirect("/messages", uploadErrors.map((e) => `${e.file}: ${e.reason}`).join(" "));
  }
  redirect("/messages");
}
