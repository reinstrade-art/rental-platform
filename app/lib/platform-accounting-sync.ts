import "server-only";
import { prisma } from "./prisma";
import { postMoneyTransactionToWave } from "./wave";

/**
 * Pushes the platform's own money events to Wave — the mirror of
 * accounting-sync.ts, but for PlatformAccountingConnection/
 * PlatformAccountingSyncLog rather than an org's own AccountingConnection.
 * Always writes a log row, success or failure, so a sync that fails is
 * visible on the Platform Admin → Accounting page, never a silent gap.
 */

export async function syncLicensePaymentToWave(licensePaymentId: string): Promise<void> {
  const [connection, payment] = await Promise.all([
    prisma.platformAccountingConnection.findUnique({ where: { id: "default" } }),
    prisma.licensePayment.findUnique({ where: { id: licensePaymentId }, include: { organization: { select: { name: true } } } }),
  ]);
  if (!connection || !payment || payment.status !== "SUCCESS") return;

  const existing = await prisma.platformAccountingSyncLog.findUnique({ where: { licensePaymentId } });
  if (existing?.status === "SUCCESS") return;

  const log = existing
    ? await prisma.platformAccountingSyncLog.update({ where: { id: existing.id }, data: { status: "PENDING", error: null } })
    : await prisma.platformAccountingSyncLog.create({
        data: { kind: "LICENSE_PAYMENT", licensePaymentId, status: "PENDING" },
      });

  try {
    const { externalId } = await postMoneyTransactionToWave({
      kind: "INCOME",
      amount: payment.amount,
      date: payment.createdAt,
      description: `License — ${payment.organization.name}`,
      externalId: `license-${payment.id}`,
    });
    await prisma.platformAccountingSyncLog.update({
      where: { id: log.id },
      data: { status: "SUCCESS", externalId, syncedAt: new Date(), error: null },
    });
  } catch (e) {
    await prisma.platformAccountingSyncLog.update({
      where: { id: log.id },
      data: { status: "FAILED", error: e instanceof Error ? e.message : "Sync failed." },
    });
  }
}

export async function syncPayoutToWave(payoutId: string): Promise<void> {
  const [connection, payout] = await Promise.all([
    prisma.platformAccountingConnection.findUnique({ where: { id: "default" } }),
    prisma.payout.findUnique({ where: { id: payoutId }, include: { organization: { select: { name: true } } } }),
  ]);
  if (!connection || !payout || payout.status !== "SUCCESS") return;

  const existing = await prisma.platformAccountingSyncLog.findUnique({ where: { payoutId } });
  if (existing?.status === "SUCCESS") return;

  const log = existing
    ? await prisma.platformAccountingSyncLog.update({ where: { id: existing.id }, data: { status: "PENDING", error: null } })
    : await prisma.platformAccountingSyncLog.create({
        data: { kind: "PAYOUT", payoutId, status: "PENDING" },
      });

  try {
    const { externalId } = await postMoneyTransactionToWave({
      kind: "EXPENSE",
      amount: payout.netAmount,
      date: payout.completedAt ?? payout.createdAt,
      description: `Rent payout — ${payout.organization.name}`,
      externalId: `payout-${payout.id}`,
    });
    await prisma.platformAccountingSyncLog.update({
      where: { id: log.id },
      data: { status: "SUCCESS", externalId, syncedAt: new Date(), error: null },
    });
  } catch (e) {
    await prisma.platformAccountingSyncLog.update({
      where: { id: log.id },
      data: { status: "FAILED", error: e instanceof Error ? e.message : "Sync failed." },
    });
  }
}

/** Catches up every SUCCESS LicensePayment/Payout that has never successfully synced — capped so one click can't run past a serverless function's own timeout. Filtered in code rather than the query itself: an optional one-to-one relation's "not successfully synced yet" (never synced, OR synced but FAILED) is simpler to express as a JS predicate than as a nested Prisma where. */
export async function syncAllUnsyncedPlatformTransactions(limit = 200): Promise<{ attempted: number }> {
  const [licensePayments, payouts] = await Promise.all([
    prisma.licensePayment.findMany({
      where: { status: "SUCCESS" },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: { id: true, platformAccountingSyncLog: { select: { status: true } } },
    }),
    prisma.payout.findMany({
      where: { status: "SUCCESS" },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: { id: true, platformAccountingSyncLog: { select: { status: true } } },
    }),
  ]);

  const unsyncedLicensePayments = licensePayments.filter((p) => p.platformAccountingSyncLog?.status !== "SUCCESS");
  const unsyncedPayouts = payouts.filter((p) => p.platformAccountingSyncLog?.status !== "SUCCESS");

  for (const p of unsyncedLicensePayments) await syncLicensePaymentToWave(p.id);
  for (const p of unsyncedPayouts) await syncPayoutToWave(p.id);
  return { attempted: unsyncedLicensePayments.length + unsyncedPayouts.length };
}
