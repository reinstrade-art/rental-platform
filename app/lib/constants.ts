// UTILITY is no longer offered when raising a new charge, but stays valid so
// charges already on file (older manual entries, and older CSV imports —
// see ingestRentRoll, which now writes HYGIENE instead) keep displaying
// correctly rather than falling back to a raw, unlabeled type string.
export const CHARGE_TYPES = ["RENT", "DEPOSIT", "WATER", "HYGIENE", "LATE_FEE"] as const;
export type ChargeType = (typeof CHARGE_TYPES)[number];

export const CHARGE_TYPE_LABEL: Record<string, string> = {
  RENT: "Rent",
  DEPOSIT: "Deposit",
  WATER: "Water Services",
  HYGIENE: "Hygiene Services",
  LATE_FEE: "Late fee", // raised automatically by app/lib/collections.ts, or by hand
  UTILITY: "Utilities", // legacy — see comment above
};

export const LEASE_STATUSES = ["ACTIVE", "ENDED"] as const;
export type LeaseStatus = (typeof LEASE_STATUSES)[number];

export const ORG_STATUSES = ["ACTIVE", "SUSPENDED"] as const;
export type OrgStatus = (typeof ORG_STATUSES)[number];

export const REPAIR_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type RepairPriority = (typeof REPAIR_PRIORITIES)[number];

export const REPAIR_STATUSES = [
  "REPORTED",
  "QUOTING",
  "APPROVED",
  "IN_PROGRESS",
  "DONE",
  "CANCELLED",
] as const;
export type RepairStatus = (typeof REPAIR_STATUSES)[number];

export const QUOTE_STATUSES = ["SUBMITTED", "ACCEPTED", "REJECTED"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

// Ordered low → high. Index+1 is the slot's required rank, so slot 0
// (REQUESTER) is always the raiser, slot 1 needs MANAGER-or-above, slot 2
// needs DIRECTOR.
export const APPROVAL_LEVELS = ["REQUESTER", "MANAGER", "DIRECTOR"] as const;
export type ApprovalLevel = (typeof APPROVAL_LEVELS)[number];

export const APPROVAL_KINDS = ["REPAIR_WORK", "REPAIR_COST", "QUOTE_AWARD", "PAYMENT_OUT"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const EXPENSE_CATEGORIES = [
  "REPAIRS",
  "UTILITIES",
  "STAFF",
  "RATES_AND_TAXES",
  "INSURANCE",
  "LEGAL",
  "SUPPLIES",
  "OTHER",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const PAYMENT_METHODS = ["MPESA", "CASH", "BANK", "CARD", "CHEQUE"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const LICENSE_PAYMENT_METHODS = ["MPESA_STK", "BANK", "CASH", "OTHER"] as const;
export type LicensePaymentMethod = (typeof LICENSE_PAYMENT_METHODS)[number];

export const MPESA_ACCOUNT_TYPES = ["PAYBILL", "TILL"] as const;
export type MpesaAccountType = (typeof MPESA_ACCOUNT_TYPES)[number];

export const SUPPLIER_CATEGORIES = [
  "HARDWARE",
  "BUILDING_MATERIALS",
  "ELECTRICAL",
  "PLUMBING",
  "PAINT",
  "TIMBER",
  "GENERAL",
] as const;
export type SupplierCategory = (typeof SUPPLIER_CATEGORIES)[number];

// Every new organization gets this many days free from creation before it
// needs a recorded license payment to keep working — see app/lib/licensing.ts.
export const TRIAL_DAYS = 30;

// Ascending — index is used as the rank when comparing tiers, so a higher
// index always means "includes everything below it plus more" (see
// tierAtLeast/requireFeature in app/lib/tier.ts).
export const ORG_TIERS = ["BASIC", "INTERMEDIATE", "ADVANCED", "FULL"] as const;
export type OrgTier = (typeof ORG_TIERS)[number];

// Which package a module first appears in. Nothing here is a hidden
// capability — it's the same commercial packaging quoted to customers, just
// enforced in code instead of being an honor system. A feature not listed
// here is BASIC (available to everyone) by construction, via the ?? fallback
// in tierAtLeast — so a newly-added module defaults to open, never silently
// walled off because someone forgot to register it.
export const FEATURE_TIER: Record<string, OrgTier> = {
  CSV_IMPORT: "INTERMEDIATE",
  BILLING_RUN: "INTERMEDIATE",
  MULTI_STAFF: "INTERMEDIATE",
  REPAIRS: "ADVANCED",
  SUPPLIERS: "ADVANCED",
  EXPENSES: "ADVANCED",
  EVICTIONS: "ADVANCED",
  ARREARS_ALERTS: "ADVANCED",
  RECURRING_JOBS: "FULL",
  REPORTS: "FULL",
};
export type Feature = keyof typeof FEATURE_TIER;

// Modules an ADMIN can grant or withhold per MANAGER/VIEWER — see
// User.permissions and app/lib/permissions.ts. Deliberately excludes
// Dashboard (always visible, it's just a summary of what a module access
// already lets someone see) and Team/Settings (ADMIN-only regardless,
// already gated by requireOrgAdmin — narrowing those per-staff would just
// be a second, confusing way to say "not an admin").
export const MODULE_LIST = [
  "properties",
  "tenants",
  "leases",
  "messages",
  "alerts",
  "evictions",
  "payments",
  "water",
  "expenses",
  "repairs",
  "vendors",
  "suppliers",
  "reports",
  "tax",
  "approvals",
] as const;
export type ModuleKey = (typeof MODULE_LIST)[number];

/** Parses User.permissions — null/invalid means "full access", never "no access" (see the column's own schema comment for why). */
export function parsePermissions(raw: string | null): ModuleKey[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((m): m is ModuleKey => (MODULE_LIST as readonly string[]).includes(m));
  } catch {
    return null;
  }
}

export const MODULE_LABEL: Record<ModuleKey, string> = {
  properties: "Properties",
  tenants: "Tenants",
  leases: "Leases",
  messages: "Messages",
  alerts: "Alerts",
  evictions: "Evictions",
  payments: "Payments",
  water: "Water",
  expenses: "Expenses",
  repairs: "Repairs",
  vendors: "Vendors",
  suppliers: "Suppliers",
  reports: "Reports",
  tax: "Tax (KRA)",
  approvals: "Approvals",
};
