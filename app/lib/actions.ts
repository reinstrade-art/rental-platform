"use server";

import { redirect } from "next/navigation";
import { prisma } from "./prisma";
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
  verifyCredentials,
  getSession,
  impersonate,
  endImpersonation,
  revokeSession,
  revokeOtherSessions,
  revokeAllSessions,
} from "./auth";
import { checkLock, recordFailure, clearFailures } from "./throttle";
import { raiseApproval, signApproval } from "./approvals";
import { createInvitation, redeemInvitation } from "./invites";
import { ingestTransaction, matchTransaction, ignoreTransaction, parseTransactionsCsv } from "./payments";
import { logPlatformAccess } from "./audit";
import { parsePropertiesCsv, parseTenantsCsv, parseRentRollCsv, ingestRentRoll } from "./import";
import { GROUNDS_LIST, joinGrounds, validNoticeDeadline } from "./eviction";
import { applyBilling } from "./billing";
import { postRepairExpense } from "./expenses";
import { newTrialEndsAt, extendLicense, sendLicenseStkPush } from "./licensing";
import { requireFeature, getOrgTier, staffSeatLimit } from "./tier";
import { ORG_TIERS } from "./constants";

// --- auth --------------------------------------------------------------

export async function platformSetup(formData: FormData) {
  if (!(await needsPlatformSetup())) throw new Error("Platform is already set up.");

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || password.length < 8) throw new Error("Email and an 8+ character password are required.");

  const user = await prisma.user.create({
    data: { email, passwordHash: await hashPassword(password), role: "PLATFORM_ADMIN" },
  });

  await createSession({ id: user.id, organizationId: null, email: user.email, phone: null, role: user.role });
  redirect("/platform");
}

export async function login(formData: FormData) {
  const identifier = String(formData.get("identifier") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!identifier || !password) throw new Error("Enter your email/phone and password.");

  const lock = await checkLock(identifier);
  if (lock.locked) throw new Error(`Too many attempts. Try again in ${lock.minutesLeft} minute(s).`);

  const user = await verifyCredentials(identifier, password);
  if (!user) {
    const result = await recordFailure(identifier);
    if (result.locked) throw new Error(`Too many attempts. Try again in ${result.minutesLeft} minute(s).`);
    throw new Error("Incorrect email/phone or password.");
  }
  if (user.disabledAt) throw new Error("This account's access has been disabled.");
  await clearFailures(identifier);

  await createSession({
    id: user.id,
    organizationId: user.organizationId,
    email: user.email,
    phone: user.phone,
    role: user.role,
  });

  redirect(user.role === "PLATFORM_ADMIN" ? "/platform" : "/dashboard");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

// --- platform admin: organization provisioning --------------------------

export async function createOrganization(formData: FormData) {
  const s = await getSession();
  if (!requirePlatformAdmin(s)) throw new Error("Not authorized.");

  const name = String(formData.get("name") ?? "").trim();
  const adminEmail = String(formData.get("adminEmail") ?? "").trim().toLowerCase();
  const adminPassword = String(formData.get("adminPassword") ?? "");
  if (!name || !adminEmail || adminPassword.length < 8) {
    throw new Error("Organization name, admin email, and an 8+ character password are required.");
  }

  await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name, trialEndsAt: newTrialEndsAt() } });
    await tx.user.create({
      data: {
        organizationId: org.id,
        email: adminEmail,
        passwordHash: await hashPassword(adminPassword),
        role: "ADMIN",
        // Seeded so the approval chain isn't inert on day one — mirrors the
        // reference build's own migration (ADMIN → DIRECTOR).
        approvalLevel: "DIRECTOR",
      },
    });
  });

  redirect("/platform");
}

export async function setOrganizationStatus(organizationId: string, status: "ACTIVE" | "SUSPENDED") {
  const s = await getSession();
  if (!requirePlatformAdmin(s)) throw new Error("Not authorized.");
  await prisma.organization.update({ where: { id: organizationId }, data: { status } });
  await logPlatformAccess(s.userId, organizationId, status === "SUSPENDED" ? "SUSPEND_ORG" : "REACTIVATE_ORG");
}

/** Sets which commercial package a customer is on — see FEATURE_TIER in app/lib/constants.ts for what each unlocks. */
export async function updateOrgTier(organizationId: string, formData: FormData) {
  const s = await getSession();
  if (!requirePlatformAdmin(s)) throw new Error("Not authorized.");

  const tier = String(formData.get("tier") ?? "");
  if (!ORG_TIERS.includes(tier as (typeof ORG_TIERS)[number])) throw new Error("Invalid tier.");

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
  if (!amount || amount <= 0) throw new Error("Enter a positive amount.");

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
  if (!phone) throw new Error("Enter a phone number to send the prompt to.");
  if (!amount || amount <= 0) throw new Error("Enter a positive amount.");

  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  const callbackUrl = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/mpesa/license-callback`
    : `${proto}://${host}/api/mpesa/license-callback`;

  const result = await sendLicenseStkPush(organizationId, phone, amount, periodDays, s.userId, callbackUrl);
  if (!result.ok) throw new Error(result.reason);
  await logPlatformAccess(s.userId, organizationId, "SEND_LICENSE_STK", `KES ${amount} to ${phone}`);
  redirect("/platform");
}

/** Staff set their own organization's document letterhead — never another org's. */
export async function updateBranding(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const brandColor = String(formData.get("brandColor") ?? "").trim();
  if (brandColor && !/^#[0-9a-fA-F]{6}$/.test(brandColor)) {
    throw new Error("Brand color must be a hex value like #1E3350.");
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
  if (env !== "sandbox" && env !== "production") throw new Error("Invalid environment.");

  await prisma.organization.update({
    where: { id: s.organizationId },
    data: {
      mpesaEnv: env,
      mpesaShortcode: String(formData.get("mpesaShortcode") ?? "").trim() || null,
      mpesaConsumerKey: String(formData.get("mpesaConsumerKey") ?? "").trim() || null,
      mpesaConsumerSecret: String(formData.get("mpesaConsumerSecret") ?? "").trim() || null,
      mpesaPasskey: String(formData.get("mpesaPasskey") ?? "").trim() || null,
    },
  });
  redirect("/settings");
}

// --- staff: property / unit / tenant / lease / billing -------------------

export async function createProperty(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim() || null;
  if (!name) throw new Error("Property name is required.");

  await prisma.property.create({ data: { organizationId: s.organizationId, name, address } });
  redirect("/properties");
}

export async function updateProperty(propertyId: string, formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const property = await prisma.property.findFirst({ where: { id: propertyId, organizationId: s.organizationId } });
  if (!property) throw new Error("Property not found.");

  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim() || null;
  if (!name) throw new Error("Property name is required.");

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
  if (property.units.length > 0) throw new Error("Remove this property's units before deleting it.");

  await prisma.property.delete({ where: { id: propertyId } });
  redirect("/properties");
}

/** One row per property: name,address — header row optional. */
export async function importPropertiesCsv(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");
  requireFeature(await getOrgTier(s.organizationId), "CSV_IMPORT");

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Choose a CSV file.");
  const rows = parsePropertiesCsv(await file.text());
  if (rows.length === 0) throw new Error("No valid rows found — expected name,address per line.");

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
  if (!property) throw new Error("Property not found.");

  const label = String(formData.get("label") ?? "").trim();
  const monthlyRent = Number(formData.get("monthlyRent") ?? 0) || null;
  if (!label) throw new Error("Unit label is required.");

  await prisma.unit.create({
    data: { organizationId: s.organizationId, propertyId, label, monthlyRent },
  });
  redirect(`/properties/${propertyId}`);
}

export async function createTenant(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;
  if (!name) throw new Error("Tenant name is required.");

  await prisma.tenant.create({ data: { organizationId: s.organizationId, name, phone, email } });
  redirect("/tenants");
}

export async function updateTenant(tenantId: string, formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, organizationId: s.organizationId } });
  if (!tenant) throw new Error("Tenant not found.");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Tenant name is required.");

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      name,
      phone: String(formData.get("phone") ?? "").trim() || null,
      email: String(formData.get("email") ?? "").trim() || null,
    },
  });
  redirect("/tenants");
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
  if (tenant.leases.length > 0) throw new Error("Remove this tenant's leases before deleting them.");
  if (tenant.user) throw new Error("This tenant has portal access — disable it before deleting.");

  await prisma.tenant.delete({ where: { id: tenantId } });
  redirect("/tenants");
}

/** One row per tenant: name,phone,email — header row optional. */
export async function importTenantsCsv(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");
  requireFeature(await getOrgTier(s.organizationId), "CSV_IMPORT");

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Choose a CSV file.");
  const rows = parseTenantsCsv(await file.text());
  if (rows.length === 0) throw new Error("No valid rows found — expected name,phone,email per line.");

  for (const row of rows) {
    await prisma.tenant.create({ data: { organizationId: s.organizationId, name: row.name, phone: row.phone, email: row.email } });
  }
  redirect("/tenants");
}

export async function createLease(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const unitId = String(formData.get("unitId") ?? "");
  const tenantId = String(formData.get("tenantId") ?? "");
  const monthlyRent = Number(formData.get("monthlyRent") ?? 0);
  const startDate = new Date(String(formData.get("startDate") ?? ""));
  if (!unitId || !tenantId || !monthlyRent || isNaN(startDate.getTime())) {
    throw new Error("Unit, tenant, monthly rent, and a valid start date are required.");
  }

  const [unit, tenant] = await Promise.all([
    prisma.unit.findFirst({ where: { id: unitId, organizationId: s.organizationId } }),
    prisma.tenant.findFirst({ where: { id: tenantId, organizationId: s.organizationId } }),
  ]);
  if (!unit || !tenant) throw new Error("Unit or tenant not found.");

  await prisma.lease.create({
    data: { organizationId: s.organizationId, unitId, tenantId, monthlyRent, startDate, status: "ACTIVE" },
  });
  redirect("/leases");
}

export async function updateLease(leaseId: string, formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const lease = await prisma.lease.findFirst({ where: { id: leaseId, organizationId: s.organizationId } });
  if (!lease) throw new Error("Lease not found.");

  const monthlyRent = Number(formData.get("monthlyRent") ?? 0);
  const startDate = new Date(String(formData.get("startDate") ?? ""));
  const endDateRaw = String(formData.get("endDate") ?? "").trim();
  const endDate = endDateRaw ? new Date(endDateRaw) : null;
  const status = String(formData.get("status") ?? lease.status);
  if (!monthlyRent || isNaN(startDate.getTime())) throw new Error("Monthly rent and a valid start date are required.");
  if (endDateRaw && isNaN((endDate as Date).getTime())) throw new Error("Invalid end date.");
  if (status !== "ACTIVE" && status !== "ENDED") throw new Error("Invalid status.");

  await prisma.lease.update({ where: { id: leaseId }, data: { monthlyRent, startDate, endDate, status } });
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
    throw new Error("This lease has charges or payments on record — end it instead of deleting, to keep the financial history.");
  }
  if (lease.evictions.length > 0) {
    throw new Error("This lease has an eviction case on record — end the lease instead of deleting, to keep that history.");
  }

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
  if (!property) throw new Error("Select a property to import into.");

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Choose a CSV file.");
  const rows = parseRentRollCsv(await file.text());
  if (rows.length === 0) {
    throw new Error(
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
  if (!amount || isNaN(periodMonth.getTime())) throw new Error("Amount and period month are required.");

  await prisma.charge.create({
    data: { organizationId: s.organizationId, leaseId, type, amount, description, periodMonth },
  });
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
  if (!amount) throw new Error("Amount is required.");

  await prisma.payment.create({
    data: { organizationId: s.organizationId, leaseId, amount, method, reference, paidAt },
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
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error("Select a valid month.");

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
  if (!lease) throw new Error("Lease not found.");
  return lease;
}

async function requireOpenEviction(organizationId: string, id: string) {
  const ev = await prisma.eviction.findFirst({ where: { id, organizationId } });
  if (!ev) throw new Error("Eviction case not found.");
  if (["ENFORCED", "WITHDRAWN", "VACATED"].includes(ev.status)) throw new Error("This case is already closed.");
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
  if (existing) throw new Error("There is already an open eviction case for this lease.");

  const codes = GROUNDS_LIST.filter((g) => formData.get(`ground_${g}`) === "on");
  if (codes.length === 0) throw new Error("Select at least one ground.");

  const ev = await prisma.eviction.create({
    data: {
      organizationId: s.organizationId,
      leaseId: lease.id,
      grounds: joinGrounds(codes),
      groundsDetail: optStr(formData, "groundsDetail"),
      status: "NOTICE_DRAFT",
    },
  });
  redirect(`/evictions/${ev.id}`);
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
  if (isNaN(servedAt.getTime()) || isNaN(deadline.getTime())) throw new Error("Served date and deadline are required.");
  if (!validNoticeDeadline(servedAt, deadline)) throw new Error("The deadline must be at least 30 days after the served date.");

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
  if (!["RRT", "MAGISTRATE", "ELC"].includes(courtVenue)) throw new Error("Select a valid venue.");

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
  if (isNaN(vacateBy.getTime())) throw new Error("A vacant-possession date is required.");

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
  if (!ev.orderObtainedAt) throw new Error("An eviction order must be on record before this can be enforced.");

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
  if (!category || !amount || amount <= 0) throw new Error("Category and a positive amount are required.");

  const propertyId = optStr(formData, "propertyId");
  if (propertyId) {
    const property = await prisma.property.findFirst({ where: { id: propertyId, organizationId: s.organizationId } });
    if (!property) throw new Error("Property not found.");
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
  if (!expense) throw new Error("Expense not found.");
  if (expense.repairId) throw new Error("This expense was posted from a repair — edit the repair's final cost instead.");

  await prisma.expense.delete({ where: { id: expenseId } });
  redirect("/expenses");
}

// --- staff: vendors / repairs --------------------------------------------

export async function createVendor(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");
  requireFeature(await getOrgTier(s.organizationId), "REPAIRS");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Vendor name is required.");

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

// --- staff: suppliers -------------------------------------------------------
// Where materials for a repair were bought — distinct from Vendor, who is
// paid for labour. See app/lib/tier.ts — bundled with Repairs, same package.

export async function createSupplier(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");
  requireFeature(await getOrgTier(s.organizationId), "SUPPLIERS");

  const name = str(formData, "name");
  if (!name) throw new Error("Supplier name is required.");

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
  if (!supplier) throw new Error("Supplier not found.");

  const name = str(formData, "name");
  if (!name) throw new Error("Supplier name is required.");

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
  redirect("/suppliers");
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
  if (!propertyId || !title) throw new Error("Property and title are required.");

  const property = await prisma.property.findFirst({ where: { id: propertyId, organizationId: s.organizationId } });
  if (!property) throw new Error("Property not found.");
  if (unitId) {
    const unit = await prisma.unit.findFirst({ where: { id: unitId, organizationId: s.organizationId, propertyId } });
    if (!unit) throw new Error("Unit not found on that property.");
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
  if (!repair) throw new Error("Repair not found.");
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
  if (!vendorId || !amount) throw new Error("Vendor and amount are required.");

  const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, organizationId: s.organizationId } });
  if (!vendor) throw new Error("Vendor not found.");

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
  if (!quote) throw new Error("Quote not found.");

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
  if (!repair.workApprovedAt) throw new Error("Work must be approved before cost can be approved.");

  const approvedCost = Number(formData.get("approvedCost") ?? 0);
  if (!approvedCost) throw new Error("Approved cost is required.");

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
  if (!repair.costApprovedAt) throw new Error("Cost must be approved before a repair can be marked done.");

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
    throw new Error("Fill in the job, property, cost, and frequency.");
  }

  const property = await prisma.property.findFirst({ where: { id: propertyId, organizationId: s.organizationId } });
  if (!property) throw new Error("Property not found.");

  const vendorId = optStr(formData, "vendorId");
  if (vendorId) {
    const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, organizationId: s.organizationId } });
    if (!vendor) throw new Error("Vendor not found.");
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
  if (!tenant) throw new Error("Tenant not found.");
  if (!tenant.email && !tenant.phone) throw new Error("Tenant needs an email or phone on file before inviting.");

  const invite = await createInvitation(
    s.organizationId,
    "TENANT",
    { tenantId },
    { email: tenant.email ?? undefined, phone: tenant.phone ?? undefined },
  );
  redirect(`/invites/${invite.id}`);
}

export async function inviteVendor(vendorId: string, formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, organizationId: s.organizationId } });
  if (!vendor) throw new Error("Vendor not found.");
  if (!vendor.email && !vendor.phone) throw new Error("Vendor needs an email or phone on file before inviting.");

  const workerType = String(formData.get("workerType") ?? "TRADESMAN");
  if (workerType !== "TRADESMAN" && workerType !== "CASUAL_LABOURER") throw new Error("Invalid role.");

  const invite = await createInvitation(
    s.organizationId,
    workerType,
    { vendorId },
    { email: vendor.email ?? undefined, phone: vendor.phone ?? undefined },
  );
  redirect(`/invites/${invite.id}`);
}

// --- public: registration --------------------------------------------------

export async function registerWithInvite(formData: FormData) {
  const code = String(formData.get("code") ?? "");
  const identifier = String(formData.get("identifier") ?? "");
  const password = String(formData.get("password") ?? "");
  const consented = formData.get("consent") === "on";
  if (!code || !identifier || !password) throw new Error("Code, email/phone, and password are all required.");

  // Same lockout machinery as login, keyed on the code itself rather than an
  // identifier — a wrong-guess run against one code locks out further
  // guesses at that code specifically, without touching anyone else's.
  const lock = await checkLock(`invite:${code}`);
  if (lock.locked) throw new Error(`Too many attempts. Try again in ${lock.minutesLeft} minute(s).`);

  const result = await redeemInvitation(code, identifier, password, consented);
  if (!result.ok) {
    await recordFailure(`invite:${code}`);
    throw new Error(result.error);
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
    result.role === "TENANT" ? "/portal" : result.role === "MANAGER" || result.role === "VIEWER" ? "/dashboard" : "/trade",
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
  if (!amount || isNaN(occurredAt.getTime())) throw new Error("Amount and date are required.");

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
  if (!(file instanceof File)) throw new Error("Choose a CSV file.");
  const text = await file.text();
  const rows = parseTransactionsCsv(text);
  if (rows.length === 0) throw new Error("No valid rows found — expected date,amount,reference,payer per line.");

  for (const row of rows) {
    await ingestTransaction({ organizationId: s.organizationId, source: "CSV_IMPORT", ...row });
  }
  redirect("/payments");
}

export async function matchTransactionAction(transactionId: string, formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const leaseId = String(formData.get("leaseId") ?? "");
  if (!leaseId) throw new Error("Select a lease to match this transaction to.");

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

  const limit = staffSeatLimit(await getOrgTier(s.organizationId));
  if (limit !== null) {
    const seats = await prisma.user.count({
      where: { organizationId: s.organizationId, role: { in: ["ADMIN", "MANAGER", "VIEWER"] }, disabledAt: null },
    });
    if (seats >= limit) {
      throw new Error(`Your plan is limited to ${limit} staff seat${limit === 1 ? "" : "s"} — upgrade to add teammates.`);
    }
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "VIEWER");
  if (!email) throw new Error("Email is required.");
  if (role !== "MANAGER" && role !== "VIEWER") throw new Error("Invalid role.");

  const invite = await createInvitation(s.organizationId, role, {}, { email });
  redirect(`/invites/${invite.id}`);
}

/** Promotes/demotes between MANAGER and VIEWER. Never targets ADMIN — that seat is fixed at org creation. */
export async function setStaffRole(userId: string, role: "MANAGER" | "VIEWER") {
  const s = await getSession();
  if (!requireOrgAdmin(s)) throw new Error("Only an organization admin can change staff roles.");

  const user = await prisma.user.findFirst({ where: { id: userId, organizationId: s.organizationId } });
  if (!user) throw new Error("Not found.");
  if (user.role === "ADMIN") throw new Error("Cannot change the admin's role.");

  await prisma.user.update({ where: { id: userId }, data: { role } });
}

/** Revokes access without deleting the account — history stays attached to a real row. Every session is signed out immediately. */
export async function disableStaff(userId: string) {
  const s = await getSession();
  if (!requireOrgAdmin(s)) throw new Error("Only an organization admin can disable staff.");

  const user = await prisma.user.findFirst({ where: { id: userId, organizationId: s.organizationId } });
  if (!user) throw new Error("Not found.");
  if (user.role === "ADMIN") throw new Error("Cannot disable the admin.");

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

// --- staff: impersonation ------------------------------------------------

/** Opens a session as another user in the same organization — see app/lib/auth.ts `impersonate()` for the rules. */
export async function impersonateAction(targetUserId: string) {
  const s = await getSession();
  if (!requireOrgAdmin(s)) throw new Error("Only an organization admin can sign in as someone else.");
  await impersonate(s, targetUserId);
  redirect("/dashboard");
}

/** Hands the session back to the admin who opened it. */
export async function endImpersonationAction() {
  await endImpersonation();
  redirect("/users");
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
  if (!signatureImage.startsWith("data:image/png;base64,")) throw new Error("Please draw your signature first.");
  if (!signedByName) throw new Error("Enter the name you're signing as.");

  const lease = await prisma.lease.findFirst({
    where: { id: leaseId, organizationId: s.organizationId, tenantId: s.tenantId },
  });
  if (!lease) throw new Error("Lease not found.");
  if (lease.signedAt) throw new Error("This lease has already been signed.");

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
}

// --- messages ---------------------------------------------------------------
// One thread per tenant, office and tenant writing into the same list.

/** The tenant's own line in their thread with the office. */
export async function sendTenantMessage(formData: FormData) {
  const s = await getSession();
  if (!requireTenant(s)) throw new Error("Not authorized.");

  const body = String(formData.get("body") ?? "").trim();
  if (!body) throw new Error("Write a message first.");
  if (body.length > 2000) throw new Error("Please keep it under 2000 characters.");

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: s.tenantId! } });
  await prisma.message.create({
    data: { organizationId: s.organizationId, tenantId: tenant.id, body, fromTenant: true, authorName: tenant.name },
  });
  redirect("/portal");
}

/** The office replying in a tenant's thread — never a tenant's own session. */
export async function replyToTenant(tenantId: string, formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

  const tenant = await prisma.tenant.findFirst({ where: { id: tenantId, organizationId: s.organizationId } });
  if (!tenant) throw new Error("Tenant not found.");

  const body = String(formData.get("body") ?? "").trim();
  if (!body) throw new Error("Write a message first.");

  await prisma.message.create({
    data: {
      organizationId: s.organizationId,
      tenantId,
      body: body.slice(0, 2000),
      fromTenant: false,
      authorName: s.email ?? s.phone ?? "Staff",
    },
  });
  redirect("/messages");
}
