import "server-only";
import { prisma } from "./prisma";

export type AuditAction =
  | "VIEW_ORG_DETAIL"
  | "SUSPEND_ORG"
  | "REACTIVATE_ORG"
  | "RECORD_LICENSE_PAYMENT"
  | "SEND_LICENSE_STK"
  | "SET_ORG_TIER"
  | "IMPERSONATE_ORG"
  | "RESET_STAFF_PASSWORD";

/**
 * The only place a row is ever written to AuditLog. Called from the page
 * itself when a platform admin views an organization's data, and from the
 * suspend/reactivate action — so "every cross-org access is logged" holds
 * by construction rather than by remembering to call this everywhere.
 */
export async function logPlatformAccess(
  platformAdminId: string,
  organizationId: string,
  action: AuditAction,
  detail?: string,
) {
  await prisma.auditLog.create({
    data: { platformAdminId, organizationId, action, detail: detail ?? null },
  });
}

export async function getAuditLog(organizationId?: string) {
  return prisma.auditLog.findMany({
    where: organizationId ? { organizationId } : undefined,
    include: { platformAdmin: true, organization: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
}
