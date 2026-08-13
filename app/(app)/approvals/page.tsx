import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getOpenApprovals } from "@/app/lib/approvals";
import { signApprovalAction } from "@/app/lib/actions";
import { APPROVAL_LEVELS } from "@/app/lib/constants";

const KIND_LABEL: Record<string, string> = {
  REPAIR_WORK: "Approve repair work",
  REPAIR_COST: "Approve repair cost",
  QUOTE_AWARD: "Award quote",
};

export default async function ApprovalsPage() {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  const requests = await getOpenApprovals(s.organizationId);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Approvals</h1>
        <p className="text-sm text-silver-dark">
          Chain length for this organization: {requests[0]?.organization.approvalChainLength ?? "—"} signature(s).
          Requests apply the moment the last signature lands.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {requests.map((r) => {
          const chainLength = r.organization.approvalChainLength;
          const nextSlot = r.steps.length;
          const nextLevel = nextSlot < chainLength ? APPROVAL_LEVELS[nextSlot] : null;
          const canSign = s.userId && nextLevel;

          return (
            <div key={r.id} className="rounded border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{KIND_LABEL[r.kind] ?? r.kind}</div>
                  <div className="text-xs text-silver-dark">
                    Raised by {r.raisedBy.email ?? r.raisedBy.phone} on {new Date(r.raisedAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="text-sm text-silver-dark">
                  {r.steps.length} / {chainLength} signed
                </div>
              </div>

              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {r.steps.map((step) => (
                  <li key={step.id}>
                    {step.level} — {step.user.email ?? step.user.phone}
                    {step.action === "OVERRIDDEN" && (
                      <span className="ml-1 text-xs text-orange-600">(stand-in, no eligible distinct signer)</span>
                    )}
                  </li>
                ))}
              </ul>

              {canSign && (
                <form action={signApprovalAction.bind(null, r.id)} className="mt-3">
                  <button className="rounded bg-ink px-3 py-1.5 text-sm text-lily transition-colors hover:bg-ink-soft">Sign as {nextLevel}</button>
                </form>
              )}
            </div>
          );
        })}
        {requests.length === 0 && <p className="text-sm text-silver-dark">No pending approvals.</p>}
      </div>
    </div>
  );
}
