// PLATFORM_ADMIN is cross-org (organizationId null). Every other role belongs
// to exactly one organization. STAFF_ROLES/TRADE_ROLES are allow-lists, not
// "not an outside role" — that inversion was a real defect class in the HM
// Kariuki reference build (a new outside role would silently inherit the
// whole operator app by omission the moment it existed).
export const PLATFORM_ROLES = ["PLATFORM_ADMIN"] as const;
export const STAFF_ROLES = ["ADMIN", "MANAGER", "VIEWER"] as const;
export const TRADE_ROLES = ["TRADESMAN", "CASUAL_LABOURER"] as const;
export const OUTSIDE_ROLES = ["TENANT", ...TRADE_ROLES] as const;

export const ALL_ROLES = [...PLATFORM_ROLES, ...STAFF_ROLES, ...OUTSIDE_ROLES] as const;
export type Role = (typeof ALL_ROLES)[number];

export function isPlatformAdmin(role: string | null | undefined): boolean {
  return role === "PLATFORM_ADMIN";
}

export function isStaff(role: string | null | undefined): boolean {
  return Boolean(role) && (STAFF_ROLES as readonly string[]).includes(role!);
}

export function isTenant(role: string | null | undefined): boolean {
  return role === "TENANT";
}

export function isTradesman(role: string | null | undefined): boolean {
  return Boolean(role) && (TRADE_ROLES as readonly string[]).includes(role!);
}
