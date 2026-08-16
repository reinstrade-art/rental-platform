import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { postRepairExpense } from "@/app/lib/expenses";

/**
 * The platform's one daily job: recurring vendor work (cleaning and the
 * like) whose cost and frequency are already agreed, raised the moment it
 * falls due — already DONE, posted straight to Expenses via the same path a
 * human-completed repair uses (postRepairExpense), never routed through the
 * quote/approval flow a first-time job would need.
 *
 * Runs across every organization in one pass rather than one cron per org —
 * Vercel's own scheduling is platform-wide, not tenant-scoped, and a single
 * daily trigger comfortably covers however many due jobs exist.
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

  return NextResponse.json({ recurringJobsRaised: raised.length });
}
