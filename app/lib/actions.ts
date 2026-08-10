"use server";

import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import {
  createSession,
  destroySession,
  hashPassword,
  needsPlatformSetup,
  requireStaff,
  requirePlatformAdmin,
  verifyCredentials,
  getSession,
} from "./auth";
import { checkLock, recordFailure, clearFailures } from "./throttle";
import { raiseApproval, signApproval } from "./approvals";
import { createInvitation, redeemInvitation } from "./invites";
import { ingestTransaction, matchTransaction, ignoreTransaction, parseTransactionsCsv } from "./payments";
import { logPlatformAccess } from "./audit";

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
    const org = await tx.organization.create({ data: { name } });
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

// --- staff: vendors / repairs --------------------------------------------

export async function createVendor(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

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

export async function createRepair(formData: FormData) {
  const s = await getSession();
  if (!requireStaff(s)) throw new Error("Not authorized.");

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
  if (!code || !identifier || !password) throw new Error("Code, email/phone, and password are all required.");

  const result = await redeemInvitation(code, identifier, password);
  if (!result.ok) throw new Error(result.error);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
  await createSession({
    id: user.id,
    organizationId: user.organizationId,
    email: user.email,
    phone: user.phone,
    role: user.role,
  });

  redirect(result.role === "TENANT" ? "/portal" : "/trade");
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
