"use client";

import { useState } from "react";
import type { MpesaState } from "@/app/lib/mpesa-actions";
import { MpesaPay } from "./mpesa-pay";

type Direct = {
  ready: boolean;
  accountType: "PAYBILL" | "TILL";
  shortcode: string | null;
  accountRef: string | null;
  /** A direct paybill payment reconciles itself; otherwise the office posts it by hand. */
  autoMatch: boolean;
};

function CopyCode({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard blocked (insecure context, denied permission) — the
          // number is right there on screen to read, so this is a nicety.
        }
      }}
      className="ml-1 inline-flex items-center gap-1 rounded border border-silver bg-lily px-1.5 py-0.5 font-mono text-xs text-ink"
      title="Copy"
    >
      <span className="font-semibold tracking-wide">{value}</span>
      <span className="text-[10px] text-silver-dark">{copied ? "copied" : "copy"}</span>
    </button>
  );
}

/**
 * The one payment panel — an instant STK prompt and the direct M-Pesa-menu
 * route, side by side against the same lease. If the prompt fails or times
 * out, the direct-pay block is highlighted as the fallback rather than
 * leaving the payer stuck.
 */
export function MpesaPayPanel({
  action,
  leaseId,
  defaultAmount,
  phone,
  editablePhone,
  buttonLabel,
  stkReady,
  direct,
}: {
  action: (prev: MpesaState, fd: FormData) => Promise<MpesaState>;
  leaseId?: string;
  defaultAmount: number;
  phone?: string | null;
  editablePhone?: boolean;
  buttonLabel?: string;
  stkReady: boolean;
  direct: Direct;
}) {
  const [stkStatus, setStkStatus] = useState<"idle" | "pending" | "success" | "failed" | "timedout">("idle");
  const emphasiseDirect = stkStatus === "failed" || stkStatus === "timedout";
  const showBoth = stkReady && direct.ready;

  if (!stkReady && !direct.ready) return null;

  return (
    <div className="flex flex-col gap-4">
      {showBoth && (
        <p className="text-xs text-silver-dark">Two ways to pay — an instant prompt, or straight from the M-Pesa menu.</p>
      )}

      {stkReady && (
        <div>
          {showBoth && (
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-silver-dark">Option 1 · Instant prompt</div>
          )}
          <MpesaPay
            action={action}
            leaseId={leaseId}
            defaultAmount={defaultAmount}
            phone={phone}
            editablePhone={editablePhone}
            buttonLabel={buttonLabel}
            onStatus={setStkStatus}
          />
        </div>
      )}

      {direct.ready && (
        <div className={`rounded border p-3 text-sm ${emphasiseDirect ? "border-ink ring-1 ring-ink" : "border-silver"} bg-silver-light`}>
          {showBoth && (
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-silver-dark">Option 2 · Pay from the M-Pesa menu</div>
          )}
          {emphasiseDirect && (
            <p className="mb-2 text-xs font-medium text-ink">The prompt didn&apos;t go through — you can still pay directly:</p>
          )}
          {direct.accountType === "PAYBILL" ? (
            <ol className="ml-4 list-decimal space-y-1 text-ink">
              <li>
                M-Pesa → <b>Lipa na M-Pesa</b> → <b>Pay Bill</b>
              </li>
              <li>
                Business number: <CopyCode value={direct.shortcode!} />
              </li>
              <li>
                Account number: <CopyCode value={direct.accountRef!} />
              </li>
              <li>Enter the amount, then your M-Pesa PIN</li>
            </ol>
          ) : (
            <ol className="ml-4 list-decimal space-y-1 text-ink">
              <li>
                M-Pesa → <b>Lipa na M-Pesa</b> → <b>Buy Goods and Services</b>
              </li>
              <li>
                Till number: <CopyCode value={direct.shortcode!} />
              </li>
              <li>Enter the amount, then your M-Pesa PIN</li>
            </ol>
          )}
          <p className="mt-2 text-xs text-silver-dark">
            {direct.autoMatch
              ? "Once M-Pesa confirms, it's matched to this account by the code above — the statement updates on its own."
              : "Tell the office once it's sent so they can post it to this account."}
          </p>
        </div>
      )}
    </div>
  );
}
