import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { getTierPrices, platformMpesaConfigured } from "@/app/lib/tier-requests";
import { downgradeTierAction, requestTierUpgrade } from "@/app/lib/actions";
import { ORG_TIERS, LICENSE_PAYMENT_METHODS, FEATURE_TIER, type OrgTier } from "@/app/lib/constants";
import { tierRank } from "@/app/lib/tier";

const FEATURE_LABEL: Record<string, string> = {
  CSV_IMPORT: "CSV import (properties, tenants, rent roll)",
  BILLING_RUN: "One-click monthly billing run",
  MULTI_STAFF: "More than one staff seat",
  REPAIRS: "Repairs, vendors & work orders",
  SUPPLIERS: "Suppliers",
  EXPENSES: "Expense tracking",
  EVICTIONS: "Eviction case management",
  ARREARS_ALERTS: "Arrears alerts",
  RECURRING_JOBS: "Recurring jobs",
  REPORTS: "Reports",
};

const TIER_BLURB: Record<OrgTier, string> = {
  BASIC: "Properties, tenants, leases, M-Pesa collection and documents — one staff seat.",
  INTERMEDIATE: "Everything in Basic, plus bulk import, one-click billing and more staff seats.",
  ADVANCED: "Everything in Intermediate, plus repairs, suppliers, expenses, evictions and arrears alerts.",
  FULL: "Everything in Advanced, plus recurring jobs and reports.",
};

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function featuresAt(tier: OrgTier): string[] {
  return Object.entries(FEATURE_LABEL)
    .filter(([key]) => FEATURE_TIER[key] === tier)
    .map(([, label]) => label);
}

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ requested?: string; downgraded?: string; error?: string }>;
}) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  const { requested, downgraded, error } = await searchParams;

  const [org, prices, pendingRequests] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: s.organizationId } }),
    getTierPrices(),
    prisma.tierChangeRequest.findMany({
      where: { organizationId: s.organizationId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const currentTier = org.tier as OrgTier;
  const canRequest = s.role === "ADMIN";
  const mpesaReady = platformMpesaConfigured();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/settings" className="text-xs underline text-silver-dark">
          Settings
        </Link>
        <h1 className="mt-1 text-lg font-semibold">Your plan</h1>
        <p className="mt-1 text-sm text-silver-dark">
          You&apos;re on <strong>{currentTier}</strong>. Upgrading unlocks more modules right away once payment is
          confirmed; downgrading is free and takes effect immediately.
        </p>
      </div>

      {error && <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {requested && (
        <div className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700">
          Upgrade requested. If you paid by M-Pesa, your package updates automatically once the payment confirms —
          usually within a minute. Otherwise, we&apos;ll confirm your payment and apply it shortly.
        </div>
      )}
      {downgraded && (
        <div className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700">
          Package changed.
        </div>
      )}

      {pendingRequests.length > 0 && (
        <div className="rounded border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-800">
          {pendingRequests.map((r) => (
            <p key={r.id}>
              Upgrade to {r.toTier} for {money(r.amount)} via {r.method} is awaiting confirmation.
            </p>
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {ORG_TIERS.map((tier) => {
          const isCurrent = tier === currentTier;
          const isUpgrade = tierRank(tier) > tierRank(currentTier);
          const isDowngrade = tierRank(tier) < tierRank(currentTier);
          const price = prices[tier];
          return (
            <div key={tier} className={`rounded border p-4 ${isCurrent ? "border-ink" : ""}`}>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">{tier}</h2>
                {isCurrent && <span className="rounded-full border border-ink px-2 py-0.5 text-xs">Current plan</span>}
              </div>
              <p className="mt-1 text-xl font-semibold">
                {price ? `KES ${money(price)}` : "Contact us"}
                {price && <span className="text-sm font-normal text-silver-dark"> / month</span>}
              </p>
              <p className="mt-2 text-sm text-silver-dark">{TIER_BLURB[tier]}</p>
              {featuresAt(tier).length > 0 && (
                <ul className="mt-3 flex flex-col gap-1 text-xs text-silver-dark">
                  {featuresAt(tier).map((f) => (
                    <li key={f}>+ {f}</li>
                  ))}
                </ul>
              )}

              {!isCurrent && canRequest && isDowngrade && (
                <form action={downgradeTierAction} className="mt-4">
                  <input type="hidden" name="toTier" value={tier} />
                  <button className="rounded border px-3 py-2 text-sm transition-colors hover:bg-silver-light">
                    Downgrade to {tier}
                  </button>
                </form>
              )}

              {!isCurrent && canRequest && isUpgrade && price && (
                <details className="mt-4">
                  <summary className="cursor-pointer rounded bg-ink px-3 py-2 text-center text-sm text-lily transition-colors hover:bg-ink-soft">
                    Upgrade to {tier}
                  </summary>
                  <form action={requestTierUpgrade} className="mt-3 flex flex-col gap-2">
                    <input type="hidden" name="toTier" value={tier} />
                    <select name="method" className="rounded border px-3 py-2 text-sm">
                      {mpesaReady && <option value="MPESA_STK">M-Pesa (instant)</option>}
                      {LICENSE_PAYMENT_METHODS.filter((m) => m !== "MPESA_STK").map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    {mpesaReady && (
                      <input name="phone" placeholder="Phone for M-Pesa prompt (2547...)" className="rounded border px-3 py-2 text-sm" />
                    )}
                    <input name="reference" placeholder="Payment reference (for bank/cash/other)" className="rounded border px-3 py-2 text-sm" />
                    <button type="submit" className="rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
                      Pay KES {money(price)} &amp; request upgrade
                    </button>
                  </form>
                </details>
              )}

              {!isCurrent && isUpgrade && !price && (
                <p className="mt-4 text-xs text-silver-dark">Price not set yet — contact us to upgrade.</p>
              )}

              {!canRequest && !isCurrent && (
                <p className="mt-4 text-xs text-silver-dark">Ask an organization admin to change the plan.</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
