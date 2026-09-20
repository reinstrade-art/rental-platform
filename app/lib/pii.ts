import { isPlatformAdmin } from "./roles";

/**
 * Who may see a tenant's full details — surname, phone number, email. Every
 * other staff account (viewers, caretakers) sees the same records with those
 * parts replaced by "xxx". Masking is applied where the page renders, on the
 * server, so the real value never reaches the browser of someone who
 * shouldn't have it — not merely hidden with CSS.
 *
 * "Manager, director and admin" is deliberately read across both ways this
 * app expresses seniority: the account's role (ADMIN, MANAGER) and its
 * separate signing authority (approvalLevel MANAGER or DIRECTOR — a VIEWER
 * granted director authority is still a director). Tenants reading their own
 * portal are outside this check entirely; it only governs staff-side views.
 */
export function canViewTenantDetails(
  s: { role: string; approvalLevel?: string | null } | null | undefined,
): boolean {
  if (!s) return false;
  if (isPlatformAdmin(s.role)) return true;
  if (s.role === "ADMIN" || s.role === "MANAGER") return true;
  return s.approvalLevel === "MANAGER" || s.approvalLevel === "DIRECTOR";
}

export const MASK = "xxx";

/** "Grace Wanjiru" → "Grace xxx". A single-word name has no second name to hide, so it's left as is. */
export function maskName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${MASK}` : name;
}

/**
 * A small bundle of view-time helpers for one page render:
 *   const v = tenantView(s);
 *   v.name(t.name)   v.phone(t.phone)   v.email(t.email)
 * `v.visible` says whether the real values are in play — use it to also drop
 * anything derived from them (a WhatsApp/tel/mailto link embeds the number
 * itself, so masking the text but keeping the link would still leak it).
 */
export function tenantView(s: { role: string; approvalLevel?: string | null } | null | undefined) {
  const visible = canViewTenantDetails(s);
  return {
    visible,
    name: (n: string) => (visible ? n : maskName(n)),
    phone: (p: string | null | undefined) => (p ? (visible ? p : MASK) : null),
    email: (e: string | null | undefined) => (e ? (visible ? e : MASK) : null),
    /** First name only — used in greetings/prompts; never reveals a surname either way. */
    first: (n: string) => n.trim().split(/\s+/)[0],
  };
}
