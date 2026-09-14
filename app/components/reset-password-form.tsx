"use client";

import { useActionState, useState } from "react";
import type { ResetPasswordState } from "@/app/lib/actions";

export function ResetPasswordForm({
  userId,
  action,
}: {
  userId: string;
  action: (prev: ResetPasswordState, fd: FormData) => Promise<ResetPasswordState>;
}) {
  const [state, formAction, pending] = useActionState<ResetPasswordState, FormData>(action, undefined);
  const [copied, setCopied] = useState(false);

  if (state?.rawPassword) {
    const rawPassword = state.rawPassword;
    return (
      <div className="rounded border border-green-300 bg-green-50 p-2 text-xs text-green-800">
        <p className="font-medium">
          New password for {state.identifier ?? "this account"} — share it now, it won&apos;t be shown again:
        </p>
        <div className="mt-1 flex items-stretch gap-2">
          <code className="block flex-1 break-all rounded border bg-lily px-2 py-1 font-mono text-xs text-ink">{rawPassword}</code>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(rawPassword);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="shrink-0 rounded border border-green-300 bg-lily px-2 text-xs text-ink transition-colors hover:bg-silver-light"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <p className="mt-1 text-xs text-green-800">They&apos;ll be asked to set their own password the moment they sign in.</p>
      </div>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="userId" value={userId} />
      {state?.error && <p className="mb-1 text-xs text-red-700">{state.error}</p>}
      <button type="submit" disabled={pending} className="text-xs underline disabled:opacity-60">
        {pending ? "Resetting…" : "Reset password"}
      </button>
    </form>
  );
}
