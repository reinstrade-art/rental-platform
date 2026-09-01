import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { postRepairExpense } from "@/app/lib/expenses";
import { applyBilling } from "@/app/lib/billing";
import { hasFeature } from "@/app/lib/tier";

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
 * daily trigger comfortably covers however many due jobs (and, on the 1st,
 * orgs) there are.
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
  // UTC, matching how periodMonth/monthStart already treat "the month" —
  // 3am UTC is comfortably still the 1st for every timezone this platform's
  // customers are actually in (Kenya, EAT, is UTC+3).
  if (now.getUTCDate() === 1) {
    const period = now.toISOString().slice(0, 7);
    const orgs = await prisma.organization.findMany({ where: { status: "ACTIVE" }, select: { id: true, tier: true } });
    const billable = orgs.filter((o) => hasFeature(o.tier, "BILLING_RUN"));
    billing = await Promise.all(
      billable.map(async (o) => ({ organizationId: o.id, ...(await applyBilling(o.id, period)) })),
    );
  }

  return NextResponse.json({
    recurringJobsRaised: raised.length,
    billing: billing.length ? billing : undefined,
  });
}
