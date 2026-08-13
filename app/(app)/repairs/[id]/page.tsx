import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getRepair, getVendors } from "@/app/lib/data";
import { getApprovalForSubject } from "@/app/lib/approvals";
import {
  sendWorkOrder,
  submitQuote,
  acceptQuote,
  approveWork,
  approveCost,
  markRepairDone,
} from "@/app/lib/actions";

function money(n: number | null | undefined) {
  return n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function PendingNote({ request }: { request: { steps: unknown[] } | null }) {
  if (!request) return null;
  return (
    <p className="mt-1 text-xs text-silver-dark">
      Pending — {request.steps.length} signature(s) so far.{" "}
      <Link href="/approvals" className="underline">
        Sign on the Approvals page
      </Link>
      .
    </p>
  );
}

export default async function RepairDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  const { id } = await params;
  const [repair, vendors] = await Promise.all([getRepair(s.organizationId, id), getVendors(s.organizationId)]);
  if (!repair) notFound();

  const [awardRequest, workRequest, costRequest] = await Promise.all([
    getApprovalForSubject(s.organizationId, "QUOTE_AWARD", repair.id),
    getApprovalForSubject(s.organizationId, "REPAIR_WORK", repair.id),
    getApprovalForSubject(s.organizationId, "REPAIR_COST", repair.id),
  ]);

  const prequalifiedVendors = vendors.filter((v) => v.prequalified);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold">{repair.title}</h1>
        <p className="text-sm text-silver-dark">
          {repair.property.name}
          {repair.unit ? ` / ${repair.unit.label}` : " (common area)"} · {repair.priority} · {repair.status}
        </p>
        {repair.description && <p className="mt-2 text-sm">{repair.description}</p>}
      </div>

      {/* Work order */}
      {!repair.workOrderSentAt ? (
        <div className="max-w-sm">
          <h2 className="font-semibold">Send work order</h2>
          <p className="text-xs text-silver-dark">
            Marks this repair as open for quotes. {prequalifiedVendors.length} prequalified vendor(s) available.
          </p>
          <form action={sendWorkOrder.bind(null, repair.id)} className="mt-2 flex flex-col gap-2">
            <input name="workOrderRef" placeholder="Work order reference (optional)" className="rounded border px-3 py-2" />
            <button type="submit" className="rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
              Send work order
            </button>
          </form>
        </div>
      ) : (
        <p className="text-sm text-silver-dark">
          Work order sent {new Date(repair.workOrderSentAt).toLocaleDateString()}
          {repair.workOrderRef ? ` (ref ${repair.workOrderRef})` : ""}.
        </p>
      )}

      {/* Quotes */}
      <div>
        <h2 className="font-semibold">Quotes</h2>
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
              <th className="py-1">Vendor</th>
              <th className="py-1">Amount</th>
              <th className="py-1">Status</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {repair.quotes.map((q) => (
              <tr key={q.id} className="border-b">
                <td className="py-1">{q.vendor.name}</td>
                <td className="py-1">{money(q.amount)}</td>
                <td className="py-1">{q.status}</td>
                <td className="py-1">
                  {q.status === "SUBMITTED" && !repair.awardedVendorId && !awardRequest && (
                    <form action={acceptQuote.bind(null, repair.id, q.id)}>
                      <button className="text-xs underline">Award</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {repair.quotes.length === 0 && (
              <tr>
                <td colSpan={4} className="py-2 text-silver-dark">
                  No quotes yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {awardRequest && !repair.awardedVendorId && <PendingNote request={awardRequest} />}

        {!repair.awardedVendorId && !awardRequest && (
          <form action={submitQuote.bind(null, repair.id)} className="mt-4 flex max-w-sm flex-col gap-2">
            <select name="vendorId" required className="rounded border px-3 py-2">
              <option value="">Select vendor</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.prequalified ? "" : " (not prequalified)"}
                </option>
              ))}
            </select>
            <input name="amount" type="number" step="0.01" required placeholder="Quoted amount" className="rounded border px-3 py-2" />
            <input name="notes" placeholder="Notes (optional)" className="rounded border px-3 py-2" />
            <button type="submit" className="rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
              Submit quote
            </button>
          </form>
        )}
      </div>

      {/* Approval gates */}
      {repair.awardedVendorId && (
        <div className="max-w-sm">
          <h2 className="font-semibold">Approvals</h2>
          <p className="text-sm text-silver-dark">Awarded to {repair.awardedVendor?.name}.</p>

          <div className="mt-3 flex flex-col gap-4">
            <div>
              <p className="text-sm">
                Work approval:{" "}
                {repair.workApprovedAt ? `approved ${new Date(repair.workApprovedAt).toLocaleDateString()}` : "pending"}
              </p>
              {!repair.workApprovedAt && !workRequest && (
                <form action={approveWork.bind(null, repair.id)} className="mt-1">
                  <button className="rounded bg-ink px-3 py-1.5 text-sm text-lily transition-colors hover:bg-ink-soft">Approve work</button>
                </form>
              )}
              {!repair.workApprovedAt && workRequest && <PendingNote request={workRequest} />}
            </div>

            <div>
              <p className="text-sm">
                Cost approval:{" "}
                {repair.costApprovedAt
                  ? `approved ${money(repair.approvedCost)} on ${new Date(repair.costApprovedAt).toLocaleDateString()}`
                  : "pending"}
              </p>
              {repair.workApprovedAt && !repair.costApprovedAt && !costRequest && (
                <form action={approveCost.bind(null, repair.id)} className="mt-1 flex gap-2">
                  <input
                    name="approvedCost"
                    type="number"
                    step="0.01"
                    required
                    placeholder="Approved cost"
                    className="w-40 rounded border px-3 py-2"
                  />
                  <button className="rounded bg-ink px-3 py-1.5 text-sm text-lily transition-colors hover:bg-ink-soft">Approve cost</button>
                </form>
              )}
              {!repair.costApprovedAt && costRequest && <PendingNote request={costRequest} />}
            </div>

            {repair.costApprovedAt && repair.status !== "DONE" && (
              <div>
                <p className="text-sm">Mark this repair complete:</p>
                <form action={markRepairDone.bind(null, repair.id)} className="mt-1 flex gap-2">
                  <input
                    name="finalCost"
                    type="number"
                    step="0.01"
                    defaultValue={repair.approvedCost ?? undefined}
                    placeholder="Final cost"
                    className="w-40 rounded border px-3 py-2"
                  />
                  <button className="rounded bg-ink px-3 py-1.5 text-sm text-lily transition-colors hover:bg-ink-soft">Mark done</button>
                </form>
              </div>
            )}

            {repair.status === "DONE" && (
              <p className="text-sm text-green-700">
                Done {new Date(repair.completedAt!).toLocaleDateString()} — final cost {money(repair.finalCost)}.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
