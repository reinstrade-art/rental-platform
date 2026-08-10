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

export const APPROVAL_KINDS = ["REPAIR_WORK", "REPAIR_COST", "QUOTE_AWARD"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];
