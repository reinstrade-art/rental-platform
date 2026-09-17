// PLATFORM_ADMIN is cross-org (organizationId null). Every other role belongs
// to exactly one organization. STAFF_ROLES/TRADE_ROLES are allow-lists, not
// "not an outside role" — that inversion was a real defect class in the HM
// Kariuki reference build (a new outside role would silently inherit the
// whole operator app by omission the moment it existed).
export const PLATFORM_ROLES = ["PLATFORM_ADMIN"] as const;
export const STAFF_ROLES = ["ADMIN", "MANAGER", "VIEWER"] as const;
// A property caretaker is deliberately its own list, not folded into
// STAFF_ROLES — isStaff()/requireStaff() gate every module in the app by
// default, so a caretaker failing that check is what keeps them out of
// everything except the Tenants module, which opts them in explicitly (see
// requireTenantsAccess in app/lib/auth.ts). Adding CARETAKER to STAFF_ROLES
// instead would hand it every module the moment it existed, the exact
// failure mode the paragraph above warns about.
export const CARETAKER_ROLES = ["CARETAKER"] as const;
export const TRADE_ROLES = ["TRADESMAN", "CASUAL_LABOURER"] as const;
export const OUTSIDE_ROLES = ["TENANT", ...TRADE_ROLES] as const;

export const ALL_ROLES = [...PLATFORM_ROLES, ...STAFF_ROLES, ...CARETAKER_ROLES, ...OUTSIDE_ROLES] as const;
export type Role = (typeof ALL_ROLES)[number];

export function isPlatformAdmin(role: string | null | undefined): boolean {
  return role === "PLATFORM_ADMIN";
}

export function isStaff(role: string | null | undefined): boolean {
  return Boolean(role) && (STAFF_ROLES as readonly string[]).includes(role!);
}

export function isCaretaker(role: string | null | undefined): boolean {
  return role === "CARETAKER";
}

export function isTenant(role: string | null | undefined): boolean {
  return role === "TENANT";
}

export function isTradesman(role: string | null | undefined): boolean {
  return Boolean(role) && (TRADE_ROLES as readonly string[]).includes(role!);
}

/**
 * ADMIN, MANAGER and the cross-org PLATFORM_ADMIN see a tenant's real name,
 * phone and email; everyone else (VIEWER, CARETAKER, and every outside/trade
 * role) sees them masked — see app/lib/tenant-privacy.ts for the masking
 * itself. Deliberately a role check, not a grantable module permission like
 * MODULE_LIST: this is about who an org trusts with a tenant's personal
 * details, not which parts of the app someone's day-to-day job touches.
 */
export function canViewTenantPII(role: string | null | undefined): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "PLATFORM_ADMIN";
}
