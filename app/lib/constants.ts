export const CHARGE_TYPES = ["RENT", "UTILITY", "DEPOSIT"] as const;
export type ChargeType = (typeof CHARGE_TYPES)[number];

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

export const PAYMENT_METHODS = ["MPESA", "CASH", "BANK", "CHEQUE"] as const;
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
