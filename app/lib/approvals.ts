import "server-only";
import { prisma } from "./prisma";
import { APPROVAL_LEVELS, type ApprovalKind, type ApprovalLevel } from "./constants";
import { sendPushToUsers } from "./push";

const RANK: Record<string, number> = { REQUESTER: 1, MANAGER: 2, DIRECTOR: 3 };
function rankOf(level: string | null | undefined): number {
  return RANK[level ?? ""] ?? 0;
}

const KIND_LABEL: Record<string, string> = {
  REPAIR_WORK: "a repair",
  REPAIR_COST: "a repair's cost",
  QUOTE_AWARD: "a quote award",
  PAYMENT_OUT: "an expense",
};

/**
 * Raises a request and immediately files the raiser's own signature into the
 * REQUESTER slot — the reference design's "the raiser counts as the first
 * signature" rule. If the organization's chain is only 1 signature long,
 * that alone resolves it.
 */
export async function raiseApproval(
  organizationId: string,
  kind: ApprovalKind,
  subjectId: string,
  raisedById: string,
  payload?: Record<string, unknown>,
) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });

  const request = await prisma.approvalRequest.create({
    data: {
      organizationId,
      kind,
      subjectId,
      raisedById,
      payload: payload ? JSON.stringify(payload) : null,
    },
  });
  await prisma.approvalStep.create({
    data: { requestId: request.id, userId: raisedById, level: "REQUESTER", action: "APPROVED" },
  });

  if (org.approvalChainLength <= 1) {
    await resolve(request.id);
  } else {
    // Whoever's ranked high enough to sign the next slot — the raiser's own
    // REQUESTER step above never counts as one of these, so this is always
    // someone new being asked for a signature.
    const eligible = await prisma.user.findMany({
      where: { organizationId, id: { not: raisedById }, approvalLevel: { in: ["MANAGER", "DIRECTOR"] }, disabledAt: null },
      select: { id: true },
    });
    if (eligible.length > 0) {
      await sendPushToUsers(eligible.map((u) => u.id), {
        title: "Approval needed",
        body: `${KIND_LABEL[kind] ?? "A request"} is waiting on your signature.`,
        data: { kind: "approval", requestId: request.id },
      });
    }
  }
  return request;
}

/**
 * Records one more signature. Throws if the caller isn't ranked for the next
 * slot. The stand-in rule: a caller may sign a second time for the same
 * request ONLY if nobody else in the organization is both ranked high enough
 * for the slot and hasn't already signed — and that step is recorded as
 * OVERRIDDEN, never as an ordinary APPROVED, so the chain's history shows
 * exactly what happened rather than pretending three people signed.
 */
export async function signApproval(organizationId: string, requestId: string, userId: string) {
  const request = await prisma.approvalRequest.findFirst({
    where: { id: requestId, organizationId },
    include: { steps: true, organization: true },
  });
  if (!request) throw new Error("Request not found.");
  if (request.status !== "PENDING") throw new Error("This request has already been resolved.");

  const chainLength = request.organization.approvalChainLength;
  const slotIndex = request.steps.length; // 0 was filled by the raiser already
  if (slotIndex >= chainLength) throw new Error("Nothing left to sign on this request.");

  const requiredRank = slotIndex + 1;
  const level: ApprovalLevel = APPROVAL_LEVELS[requiredRank - 1];

  const user = await prisma.user.findFirst({ where: { id: userId, organizationId } });
  if (!user) throw new Error("Not authorized.");
  if (rankOf(user.approvalLevel) < requiredRank) {
    throw new Error(`This step needs ${level}-level authority or higher.`);
  }

  const signedUserIds = new Set(request.steps.map((s) => s.userId));
  const alreadySigned = signedUserIds.has(userId);

  if (alreadySigned) {
    const others = await prisma.user.findMany({
      where: { organizationId, id: { notIn: [...signedUserIds] } },
      select: { approvalLevel: true },
    });
    const eligibleOtherExists = others.some((o) => rankOf(o.approvalLevel) >= requiredRank);
    if (eligibleOtherExists) {
      throw new Error("Someone else must provide this signature.");
    }
  }

  await prisma.approvalStep.create({
    data: { requestId, userId, level, action: alreadySigned ? "OVERRIDDEN" : "APPROVED" },
  });

  if (slotIndex + 1 >= chainLength) await resolve(requestId);
}

async function resolve(requestId: string) {
  const request = await prisma.approvalRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { steps: { orderBy: { signedAt: "desc" }, take: 1 } },
  });
  await prisma.approvalRequest.update({
    where: { id: requestId },
    data: { status: "APPROVED", resolvedAt: new Date() },
  });
  const finalSignerId = request.steps[0]?.userId ?? request.raisedById;
  const payload = request.payload ? (JSON.parse(request.payload) as Record<string, unknown>) : {};
  await applyApproval(request.organizationId, request.kind as ApprovalKind, request.subjectId, finalSignerId, payload);
}

/**
 * The single place that turns a fully-signed request into an actual change.
 * organizationId comes from the ApprovalRequest row itself (never re-derived
 * from payload), so every write here is scoped to the org that raised the
 * request even if a future caller forgets to pre-validate subjectId's owner.
 */
async function applyApproval(
  organizationId: string,
  kind: ApprovalKind,
  subjectId: string,
  finalSignerId: string,
  payload: Record<string, unknown>,
) {
  switch (kind) {
    case "REPAIR_WORK":
      await prisma.repair.updateMany({
        where: { id: subjectId, organizationId },
        data: { workApprovedAt: new Date(), workApprovedBy: finalSignerId, status: "APPROVED" },
      });
      return;
    case "REPAIR_COST":
      await prisma.repair.updateMany({
        where: { id: subjectId, organizationId },
        data: {
          costApprovedAt: new Date(),
          costApprovedBy: finalSignerId,
          approvedCost: Number(payload.approvedCost ?? 0),
          status: "IN_PROGRESS",
        },
      });
      return;
    case "PAYMENT_OUT": {
      const p = payload as {
        organizationId: string;
        raisedById: string;
        category: string;
        amount: number;
        paidAt: string;
        description: string | null;
        payee: string | null;
        method: string | null;
        reference: string | null;
        propertyId: string | null;
      };
      await prisma.expense.create({
        data: {
          organizationId: p.organizationId,
          propertyId: p.propertyId,
          category: p.category,
          amount: p.amount,
          paidAt: new Date(p.paidAt),
          description: p.description,
          payee: p.payee,
          method: p.method,
          reference: p.reference,
          recordedBy: p.raisedById,
        },
      });
      return;
    }
    case "QUOTE_AWARD": {
      const quoteId = String(payload.quoteId);
      const quote = await prisma.quote.findFirstOrThrow({ where: { id: quoteId, organizationId } });
      await prisma.$transaction([
        prisma.quote.update({ where: { id: quoteId }, data: { status: "ACCEPTED" } }),
        prisma.quote.updateMany({
          where: { repairId: quote.repairId, id: { not: quoteId }, organizationId },
          data: { status: "REJECTED" },
        }),
        prisma.repair.updateMany({ where: { id: quote.repairId, organizationId }, data: { awardedVendorId: quote.vendorId } }),
      ]);
      return;
    }
  }
}

export async function getOpenApprovals(organizationId: string) {
  return prisma.approvalRequest.findMany({
    where: { organizationId, status: "PENDING" },
    include: { raisedBy: true, steps: { include: { user: true }, orderBy: { signedAt: "asc" } }, organization: true },
    orderBy: { raisedAt: "asc" },
  });
}

export async function getApprovalForSubject(organizationId: string, kind: ApprovalKind, subjectId: string) {
  return prisma.approvalRequest.findFirst({
    where: { organizationId, kind, subjectId, status: "PENDING" },
    include: { steps: { include: { user: true }, orderBy: { signedAt: "asc" } } },
  });
}
