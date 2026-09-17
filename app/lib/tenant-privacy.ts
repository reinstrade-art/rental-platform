/**
 * Masks a tenant's personal details for anyone who fails canViewTenantPII
 * (see app/lib/roles.ts). Pure display formatting — no DB access, safe to
 * call from a server page after fetching the real record either way, so a
 * page never has to branch its query on who's asking.
 */
import type { ReportData } from "./reports";

const MASK = "xxx";

/** Keeps the first name, masks the rest — enough to address someone by name without exposing their full legal name. */
export function maskTenantName(name: string, visible: boolean): string {
  if (visible) return name;
  const [first, ...rest] = name.trim().split(/\s+/);
  return rest.length > 0 ? `${first} ${MASK}` : first;
}

/** For phone/email/any other free-text contact field: the real value when visible, else "xxx" (or nothing, if there was nothing to hide). */
export function maskTenantValue(value: string | null | undefined, visible: boolean): string | null {
  if (visible) return value ?? null;
  return value ? MASK : null;
}

/** The monthly report's worst/best-payer tables name tenants by name — mask those two lists only; every other figure is aggregate, nothing to hide. */
export function maskReportData(data: ReportData, visible: boolean): ReportData {
  if (visible) return data;
  const mask = (rows: ReportData["worstPayers"]) => rows.map((r) => ({ ...r, tenant: maskTenantName(r.tenant, false) }));
  return { ...data, worstPayers: mask(data.worstPayers), bestPayers: mask(data.bestPayers) };
}
