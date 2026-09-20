import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { postRepairExpense } from "@/app/lib/expenses";
import { applyBilling } from "@/app/lib/billing";
import { hasFeature } from "@/app/lib/tier";
import { runCollections } from "@/app/lib/collections";
import { runArrearsWarnings } from "@/app/lib/warnings";

/**
 * The platform's daily job: recurring vendor work (cleaning and the like)
 * whose cost and frequency are already agreed, raised the moment it falls
 * due — already DONE, posted straight to Expenses via the same path a
 * human-completed repair uses (postRepairExpense), never routed through the
 * quote/approval flow a first-time job would need. On the 1st of the month,
 * also runs the same monthly billing every org's own "Raise charges" button
 * on /leases/billing-run triggers -- applyBilling() is written to be safe to
 * call more than once (a repeat run just fills whatever's still missing),
 * so there's no separate "did we already run this month" bookkeeping to get
 * wrong; a whole month of retries would all still land on the same result.
 *
 * Runs across every organization in one pass rather than one cron per org —
 * Vercel's own scheduling is platform-wide, not tenant-scoped, and a single
 * daily trigger comfortably covers however many due jobs (and, in the last
 * three days of the month, orgs) there are.
 *
 * Vercel signs its own cron requests with this header; anything else calling
 * this URL without the secret is refused.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const now = new Date();
  const due = await prisma.recurringJob.findMany({
    where: { active: true, nextDueAt: { lte: now } },
    include: { vendor: true },
  });

  const raised: string[] = [];
  for (const job of due) {
    const repair = await prisma.repair.create({
      data: {
        organizationId: job.organizationId,
        propertyId: job.propertyId,
        title: job.title,
        category: job.category,
        status: "DONE",
        awardedVendorId: job.vendorId,
        workApprovedAt: now,
        workApprovedBy: "AUTOMATIC",
        costApprovedAt: now,
        costApprovedBy: "AUTOMATIC",
        approvedCost: job.cost,
        finalCost: job.cost,
        completedAt: now,
      },
    });
    await postRepairExpense(job.organizationId, repair.id, "AUTOMATIC");

    await prisma.recurringJob.update({
      where: { id: job.id },
      data: { nextDueAt: new Date(now.getTime() + job.frequencyDays * 86_400_000) },
    });
    raised.push(repair.id);
  }

  let billing: { organizationId: string; leases: number; charges: number }[] = [];
  // Raised three days AHEAD of the month it's for, not on the 1st — a
  // tenant sees next month's charge before it's due, and the office isn't
  // relying on a cron firing exactly on the 1st for rent to be on time.
  // UTC throughout, matching how periodMonth/monthStart already treat "the
  // month" — 3am UTC is comfortably still the same calendar day for every
  // timezone this platform's customers are actually in (Kenya, EAT, is
  // UTC+3). applyBilling() is safe to call more than once (a repeat run
  // just fills whatever's still missing), so firing on all three of those
  // days rather than tracking "did this org's next month already get
  // billed" is deliberate, not a gap.
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const daysUntilNextMonth = Math.round((nextMonthStart.getTime() - now.getTime()) / 86_400_000);
  // ?period=YYYY-MM lets a same-secret manual call bill a specific month on
  // the spot — for a one-time catch-up (a month whose own 3-day window has
  // already passed, e.g. right after this schedule shipped) rather than
  // waiting for the next natural window. Vercel's own scheduled trigger
  // never sends this param, so its behaviour is unchanged.
  const overridePeriod = req.nextUrl.searchParams.get("period");
  if (overridePeriod || daysUntilNextMonth <= 3) {
    const period = overridePeriod ?? nextMonthStart.toISOString().slice(0, 7);
    const orgs = await prisma.organization.findMany({ where: { status: "ACTIVE" }, select: { id: true, tier: true } });
    const billable = orgs.filter((o) => hasFeature(o.tier, "BILLING_RUN"));
    billing = await Promise.all(
      billable.map(async (o) => ({ organizationId: o.id, ...(await applyBilling(o.id, period)) })),
    );
  }

  // Rent reminders and late fees for orgs that switched them on. Kept out of
  // the billing block's way: a failure here is reported in the response but
  // never undoes the rent charges or recurring jobs already raised above.
  let collections: Awaited<ReturnType<typeof runCollections>> | undefined;
  let collectionsError: string | undefined;
  try {
    const r = await runCollections(now);
    if (r.length) collections = r;
  } catch (e) {
    collectionsError = e instanceof Error ? e.message : "collections failed";
  }

  // The "first and final" arrears warning, on each org's chosen day of the
  // month (the 11th by default). Isolated like collections: a failure is
  // reported, never allowed to undo the work above.
  let warnings: Awaited<ReturnType<typeof runArrearsWarnings>> | undefined;
  let warningsError: string | undefined;
  try {
    const r = await runArrearsWarnings(now);
    if (r.length) warnings = r;
  } catch (e) {
    warningsError = e instanceof Error ? e.message : "warnings failed";
  }

  return NextResponse.json({
    recurringJobsRaised: raised.length,
    billing: billing.length ? billing : undefined,
    collections,
    collectionsError,
    warnings,
    warningsError,
  });
}
