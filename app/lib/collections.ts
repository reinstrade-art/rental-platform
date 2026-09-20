import "server-only";
import { prisma } from "./prisma";
import { allocate } from "./settle";
import { hasFeature } from "./tier";
import { sendEmail } from "./email";
import { sendWhatsApp } from "./whatsapp";
import { sendSms } from "./sms";
import { sendPushToUser } from "./push";
import { mpesaPayOptionsForLease } from "./mpesa-pay-options";

/**
 * Automatic collections: the reminder ladder and late fees that the best
 * property platforms run for you, so nobody on the office side has to
 * remember who to chase on the 6th.
 *
 * Research behind the cadence (see the ladder below): tenants who miss the
 * due date and get a follow-up pay on time far more often than those who
 * don't, and a heads-up a few days BEFORE the due date is the single most
 * useful nudge. So the ladder is:
 *
 *   N days before due   friendly heads-up with how to pay
 *   due day             "rent is due today"
 *   day after           "yesterday was the due date"
 *   last grace day      "a late fee applies tomorrow"   (only if fees are on)
 *   after grace         the late fee is raised as a LATE_FEE charge
 *
 * Everything is idempotent by construction. Each step first claims a
 * CollectionEvent row keyed (lease, month, step); only the run that wins the
 * insert acts. So the daily cron can run twice, be retried, or catch up after
 * a missed day and nobody is ever messaged or fined twice for the same step.
 *
 * Nothing here runs for an org unless its ADMIN has switched it on
 * (Organization.collectionsEnabled) — it raises real charges against real
 * tenants, so it is opt-in, never a default.
 */

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000; // Kenya time — "today" for a rent due date is the local calendar day
const DAY_MS = 86_400_000;

type OrgSettings = {
  id: string;
  name: string;
  collectionsEnabledAt: Date | null;
  rentDueDay: number;
  reminderDaysBefore: number;
  graceDays: number;
  lateFeeMode: string;
  lateFeeValue: number;
  mpesaShortcode: string | null;
};

export type CollectionsSummary = {
  reminders: number;
  lateFees: number;
  lateFeeTotal: number;
  /** Reminders where no channel (push, email, SMS, WhatsApp) could reach the tenant. */
  unreachable: number;
};

function money(n: number) {
  return Math.round(n).toLocaleString("en-KE");
}

function monthLabel(d: Date) {
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Sends one message down every channel that can reach this tenant; returns which ones did. SMS is preferred over WhatsApp so a tenant is never texted twice. */
async function deliver(
  tenant: { phone: string | null; email: string | null; user: { id: string; deviceTokens: { id: string }[] } | null },
  subject: string,
  text: string,
): Promise<string[]> {
  const channels: string[] = [];
  if (tenant.user && tenant.user.deviceTokens.length > 0) {
    await sendPushToUser(tenant.user.id, { title: subject, body: text }).catch(() => {});
    channels.push("push");
  }
  if (tenant.email && (await sendEmail(tenant.email, subject, text).catch(() => false))) channels.push("email");
  if (tenant.phone) {
    if (await sendSms(tenant.phone, text).catch(() => false)) channels.push("sms");
    else if (await sendWhatsApp(tenant.phone, text).catch(() => false)) channels.push("whatsapp");
  }
  return channels;
}

export async function runCollectionsForOrg(org: OrgSettings, now = new Date()): Promise<CollectionsSummary> {
  const summary: CollectionsSummary = { reminders: 0, lateFees: 0, lateFeeTotal: 0, unreachable: 0 };

  // "Today" in Kenya, as a whole day number, so day arithmetic below is exact.
  const eat = new Date(now.getTime() + EAT_OFFSET_MS);
  const y = eat.getUTCFullYear();
  const m = eat.getUTCMonth();
  const todayDay = Math.floor(Date.UTC(y, m, eat.getUTCDate()) / DAY_MS);
  const dueDay = Math.min(28, Math.max(1, org.rentDueDay));
  const dueDayNumber = Math.floor(Date.UTC(y, m, dueDay) / DAY_MS);
  const daysSinceDue = todayDay - dueDayNumber; // negative = before the due date

  const monthStart = new Date(Date.UTC(y, m, 1));
  const period = `${y}-${String(m + 1).padStart(2, "0")}`;
  const dueDate = new Date(dueDayNumber * DAY_MS);

  const feesOn = org.lateFeeMode !== "NONE" && org.lateFeeValue > 0;
  // A month whose due date fell before the policy was switched on is never
  // fined retroactively — see Organization.collectionsEnabledAt.
  const feeEligible = feesOn && (!org.collectionsEnabledAt || dueDate.getTime() + DAY_MS > org.collectionsEnabledAt.getTime());

  const orgBase = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const leases = await prisma.lease.findMany({
    where: { organizationId: org.id, status: "ACTIVE" },
    include: {
      charges: { orderBy: [{ periodMonth: "asc" }, { createdAt: "asc" }] },
      payments: { include: { allocations: true } },
      tenant: { include: { user: { select: { id: true, deviceTokens: { select: { id: true } } } } } },
      unit: { include: { property: true } },
    },
  });

  for (const lease of leases) {
    const rent = lease.charges.find((c) => c.type === "RENT" && c.periodMonth.getTime() === monthStart.getTime());
    if (!rent) continue; // nothing billed for this month, so nothing to chase

    const settled = allocate(lease.charges, lease.payments).get(rent.id)?.settled ?? false;
    if (settled) continue;

    const balance = lease.charges.reduce((s, c) => s + c.amount, 0) - lease.payments.reduce((s, p) => s + p.amount, 0);
    if (balance <= 0.5) continue;

    // Which step (if any) is due today for this lease.
    const steps: string[] = [];
    if (org.reminderDaysBefore > 0 && daysSinceDue < 0 && -daysSinceDue <= org.reminderDaysBefore) steps.push("REMINDER_BEFORE");
    if (daysSinceDue === 0) steps.push("REMINDER_DUE");
    if (daysSinceDue === 1) steps.push("REMINDER_OVERDUE");
    if (feeEligible && org.graceDays >= 2 && daysSinceDue === org.graceDays) steps.push("REMINDER_GRACE_END");
    if (feeEligible && daysSinceDue > org.graceDays) steps.push("LATE_FEE");
    if (steps.length === 0) continue;

    const first = lease.tenant.name.trim().split(/\s+/)[0];
    const where = `${lease.unit.property.name} ${lease.unit.label}`;
    const pay = await mpesaPayOptionsForLease(org.id, lease.id).catch(() => null);
    const howToPay =
      pay?.directReady && pay.shortcode
        ? pay.accountType === "TILL"
          ? ` Pay: M-Pesa Till ${pay.shortcode}.`
          : ` Pay: M-Pesa Paybill ${pay.shortcode}, Acc ${pay.accountRef ?? lease.unit.label}.`
        : orgBase
          ? ` Pay in your portal: ${orgBase.replace(/^https?:\/\//, "")}`
          : "";
    const dueLabel = dueDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

    for (const kind of steps) {
      if (kind === "LATE_FEE") {
        const fee =
          org.lateFeeMode === "PERCENT" ? Math.round((rent.amount * org.lateFeeValue) / 100) : Math.round(org.lateFeeValue);
        if (fee <= 0) continue;
        try {
          // Event + charge together: the unique event key makes a repeat
          // attempt fail here, before any second charge can exist.
          await prisma.$transaction([
            prisma.collectionEvent.create({
              data: { organizationId: org.id, leaseId: lease.id, period, kind, amount: fee },
            }),
            prisma.charge.create({
              data: {
                organizationId: org.id,
                leaseId: lease.id,
                type: "LATE_FEE",
                description: `Late fee — ${monthLabel(monthStart)} rent`,
                amount: fee,
                periodMonth: monthStart,
              },
            }),
          ]);
        } catch {
          continue; // already raised for this month
        }
        summary.lateFees++;
        summary.lateFeeTotal += fee;
        const channels = await deliver(
          lease.tenant,
          "Late fee added",
          `Hi ${first}, ${monthLabel(monthStart)} rent for ${where} wasn't paid by the grace period, so a late fee of KES ${money(fee)} was added. Balance: KES ${money(balance + fee)}.${howToPay}`,
        );
        await prisma.collectionEvent.updateMany({
          where: { leaseId: lease.id, period, kind },
          data: { channels: channels.join(",") },
        });
        continue;
      }

      // Reminders: claim the step first, then send.
      try {
        await prisma.collectionEvent.create({
          data: { organizationId: org.id, leaseId: lease.id, period, kind },
        });
      } catch {
        continue; // this step already went out
      }

      const bal = `KES ${money(balance)}`;
      const text =
        kind === "REMINDER_BEFORE"
          ? `Hi ${first}, a reminder that rent for ${where} (${bal}) is due on ${dueLabel}.${howToPay}`
          : kind === "REMINDER_DUE"
            ? `Hi ${first}, rent for ${where} (${bal}) is due today.${howToPay}`
            : kind === "REMINDER_OVERDUE"
              ? `Hi ${first}, rent for ${where} was due ${dueLabel} and ${bal} is still outstanding.${howToPay}`
              : `Hi ${first}, ${bal} is still owing for ${where}. A late fee will be added tomorrow if it isn't paid.${howToPay}`;
      const subject = kind === "REMINDER_BEFORE" ? "Rent due soon" : kind === "REMINDER_DUE" ? "Rent due today" : "Rent reminder";

      const channels = await deliver(lease.tenant, subject, text);
      summary.reminders++;
      if (channels.length === 0) summary.unreachable++;
      await prisma.collectionEvent.updateMany({
        where: { leaseId: lease.id, period, kind },
        data: { channels: channels.join(",") },
      });
    }
  }

  return summary;
}

/** Every organization that has switched collections on — what the daily cron calls. */
export async function runCollections(now = new Date()) {
  const orgs = await prisma.organization.findMany({
    where: { status: "ACTIVE", collectionsEnabled: true },
    select: {
      id: true,
      name: true,
      tier: true,
      collectionsEnabledAt: true,
      rentDueDay: true,
      reminderDaysBefore: true,
      graceDays: true,
      lateFeeMode: true,
      lateFeeValue: true,
      mpesaShortcode: true,
    },
  });

  const results: { organizationId: string; summary?: CollectionsSummary; error?: string }[] = [];
  for (const org of orgs) {
    // One org failing (a bad phone number, a provider outage) must never stop
    // the rest from being chased.
    try {
      if (!hasFeature(org.tier, "ARREARS_ALERTS")) continue;
      results.push({ organizationId: org.id, summary: await runCollectionsForOrg(org, now) });
    } catch (e) {
      results.push({ organizationId: org.id, error: e instanceof Error ? e.message : "failed" });
    }
  }
  return results;
}

const KIND_LABEL: Record<string, string> = {
  REMINDER_BEFORE: "Heads-up reminder",
  REMINDER_DUE: "Due-day reminder",
  REMINDER_OVERDUE: "Overdue reminder",
  REMINDER_GRACE_END: "Late-fee warning",
  LATE_FEE: "Late fee raised",
};
export const collectionKindLabel = (kind: string) => KIND_LABEL[kind] ?? kind;

/** The last few automatic steps for an org — shown in Settings so it's never a black box. */
export async function getRecentCollectionEvents(organizationId: string, take = 15) {
  return prisma.collectionEvent.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take,
    include: { lease: { select: { tenant: { select: { name: true } }, unit: { select: { label: true, property: { select: { name: true } } } } } } },
  });
}
