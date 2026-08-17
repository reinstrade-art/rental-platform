"use client";

import { useActionState, useEffect, useState } from "react";
import type { MpesaState } from "@/app/lib/mpesa-actions";

type PollResult = {
  status: "PENDING" | "SUCCESS" | "FAILED";
  resultDesc: string | null;
  amount: number;
  mpesaReceiptNumber: string | null;
};

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/**
 * Raises an STK push and then watches for it to resolve.
 *
 * The submit only gets back a request id — Safaricom answers on its own
 * schedule, on the phone, not in this response — so everything after "sent"
 * is a poll loop against /api/mpesa/status/[id] until the callback lands or
 * two minutes pass with no word either way.
 */
export function MpesaPay({
  action,
  leaseId,
  defaultAmount,
  phone,
  editablePhone,
  buttonLabel = "Send M-Pesa prompt",
}: {
  action: (prev: MpesaState, fd: FormData) => Promise<MpesaState>;
  leaseId?: string;
  defaultAmount: number;
  phone?: string | null;
  editablePhone?: boolean;
  buttonLabel?: string;
}) {
  const [state, formAction, pending] = useActionState<MpesaState, FormData>(action, undefined);
  // Tagged with the requestId each result belongs to, rather than reset in
  // the effect — so a poll result from a previous prompt can never render
  // for a split second against the new one, and the effect never needs to
  // call setState synchronously on entry (which was itself triggering an
  // extra cascading render for no benefit).
  const [poll, setPoll] = useState<(PollResult & { requestId: string }) | null>(null);
  const [timedOutFor, setTimedOutFor] = useState<string | null>(null);

  useEffect(() => {
    const requestId = state?.requestId;
    if (!requestId) return;
    let elapsed = 0;
    const iv = setInterval(async () => {
      elapsed += 3000;
      if (elapsed > 120_000) {
        setTimedOutFor(requestId);
        clearInterval(iv);
        return;
      }
      const res = await fetch(`/api/mpesa/status/${requestId}`).catch(() => null);
      if (!res?.ok) return;
      const data = (await res.json()) as PollResult;
      setPoll({ ...data, requestId });
      if (data.status !== "PENDING") clearInterval(iv);
    }, 3000);
    return () => clearInterval(iv);
  }, [state?.requestId]);

  const currentPoll = poll?.requestId === state?.requestId ? poll : null;
  const timedOut = timedOutFor === state?.requestId;
  const waiting = state?.requestId && (!currentPoll || currentPoll.status === "PENDING") && !timedOut;

  return (
    <form action={formAction} className="flex flex-col gap-2">
      {leaseId && <input type="hidden" name="leaseId" value={leaseId} />}
      <label className="text-xs text-silver-dark">
        Amount
        <input
          name="amount"
          type="number"
          min="1"
          step="1"
          defaultValue={Math.max(1, Math.round(defaultAmount))}
          required
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </label>
      {editablePhone ? (
        <label className="text-xs text-silver-dark">
          Phone to send the prompt to
          <input
            name="phone"
            defaultValue={phone ?? ""}
            placeholder="07XX XXX XXX"
            required
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </label>
      ) : (
        phone && <p className="text-xs text-silver-dark">Sent to {phone}.</p>
      )}

      {state?.error && <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {waiting && (
        <p className="rounded border border-silver bg-silver-light px-3 py-2 text-sm text-ink">
          Prompt sent — check the phone for the M-Pesa PIN prompt. Waiting for confirmation…
        </p>
      )}
      {currentPoll?.status === "SUCCESS" && (
        <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
          Paid {money(currentPoll.amount)}
          {currentPoll.mpesaReceiptNumber ? ` · receipt ${currentPoll.mpesaReceiptNumber}` : ""}.
        </p>
      )}
      {currentPoll?.status === "FAILED" && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {currentPoll.resultDesc ?? "The prompt was not completed."}
        </p>
      )}
      {timedOut && (
        <p className="rounded border bg-silver-light px-3 py-2 text-sm text-silver-dark">
          Still no word back — if it went through, it will show on the statement shortly.
        </p>
      )}

      <button
        type="submit"
        disabled={pending || Boolean(waiting)}
        className="rounded bg-ink px-3 py-2 text-sm text-lily disabled:opacity-60"
      >
        {pending ? "Sending…" : waiting ? "Waiting…" : buttonLabel}
      </button>
    </form>
  );
}
