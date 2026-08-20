import "server-only";
import { prisma } from "./prisma";
import { syncPaymentToQuickbooks } from "./quickbooks";

/**
 * Pushes one payment to whichever accounting system this org has connected
 * — currently only QUICKBOOKS, written so a second provider (Xero) is just
 * another branch here, not a rewrite. Always writes an AccountingSyncLog
 * row, success or failure, so nothing about a sync attempt is invisible.
 */
export async function syncPayment(organizationId: string, paymentId: string): Promise<void> {
  const [connection, payment] = await Promise.all([
    prisma.accountingConnection.findUnique({
      where: { organizationId_provider: { organizationId, provider: "QUICKBOOKS" } },
    }),
    prisma.payment.findUnique({
      where: { id: paymentId },
      include: { lease: { include: { tenant: true, unit: { include: { property: true } } } } },
    }),
  ]);
  if (!connection || !payment) return;

  const existing = await prisma.accountingSyncLog.findUnique({
    where: { paymentId_provider: { paymentId, provider: "QUICKBOOKS" } },
  });
  if (existing?.status === "SUCCESS") return;

  const log = existing
    ? await prisma.accountingSyncLog.update({ where: { id: existing.id }, data: { status: "PENDING", error: null } })
    : await prisma.accountingSyncLog.create({
        data: { organizationId, paymentId, provider: "QUICKBOOKS", status: "PENDING" },
      });

  try {
    const { externalId } = await syncPaymentToQuickbooks(connection.id, {
      id: payment.id,
      amount: payment.amount,
      paidAt: payment.paidAt,
      description: `Rent — ${payment.lease.tenant.name}, ${payment.lease.unit.property.name} / ${payment.lease.unit.label}`,
    });
    await prisma.accountingSyncLog.update({
      where: { id: log.id },
      data: { status: "SUCCESS", externalId, syncedAt: new Date(), error: null },
    });
  } catch (e) {
    await prisma.accountingSyncLog.update({
      where: { id: log.id },
      data: { status: "FAILED", error: e instanceof Error ? e.message : "Sync failed." },
    });
  }
}

/** Catches up every payment on the org's books that has never successfully synced — capped so one click can't run past a serverless function's own timeout. */
export async function syncAllUnsyncedPayments(organizationId: string, limit = 50): Promise<{ attempted: number }> {
  const payments = await prisma.payment.findMany({
    where: {
      organizationId,
      NOT: { accountingSyncLogs: { some: { provider: "QUICKBOOKS", status: "SUCCESS" } } },
    },
    orderBy: { paidAt: "asc" },
    take: limit,
    select: { id: true },
  });

  for (const p of payments) await syncPayment(organizationId, p.id);
  return { attempted: payments.length };
}
