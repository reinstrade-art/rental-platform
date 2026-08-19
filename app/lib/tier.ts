import "server-only";
import { prisma } from "./prisma";
import { ORG_TIERS, FEATURE_TIER, type OrgTier, type Feature } from "./constants";

export type { Feature } from "./constants";

function rank(tier: string): number {
  const i = ORG_TIERS.indexOf(tier as OrgTier);
  return i === -1 ? 0 : i;
}

/** Exported for callers comparing two tiers directly — e.g. "is this an upgrade or a downgrade?" */
export const tierRank = rank;

/** True once `tier` reaches at least the package `feature` first appears in. */
export function hasFeature(tier: string, feature: Feature): boolean {
  return rank(tier) >= rank(FEATURE_TIER[feature]);
}

/** Throws with a message naming the package that unlocks it — same check every gated action/page uses, so a locked module fails the same way everywhere. */
export function requireFeature(tier: string, feature: Feature) {
  if (!hasFeature(tier, feature)) {
    throw new Error(`This is part of the ${FEATURE_TIER[feature]} package — not included in your current plan.`);
  }
}

export async function getOrgTier(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { tier: true } });
  return org?.tier ?? "BASIC";
}

/** BASIC is capped at one staff seat (the founding admin) — everything above lifts the cap entirely. */
export function staffSeatLimit(tier: string): number | null {
  return tier === "BASIC" ? 1 : null;
}
