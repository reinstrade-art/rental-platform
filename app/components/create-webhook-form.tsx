"use client";

import { useActionState } from "react";
import type { WebhookState } from "@/app/lib/actions";

export function CreateWebhookForm({ action }: { action: (prev: WebhookState, fd: FormData) => Promise<WebhookState> }) {
  const [state, formAction, pending] = useActionState<WebhookState, FormData>(action, undefined);

  if (state?.secret) {
    return (
      <div className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-800">
        <p className="font-medium">Webhook added for {state.url} — copy this signing secret now, it won&apos;t be shown again:</p>
        <code className="mt-2 block break-all rounded border bg-lily px-2 py-1.5 font-mono text-xs text-ink">{state.secret}</code>
        <p className="mt-2 text-xs">
          Every delivery includes an <code className="font-mono">X-Webhook-Signature</code> header — HMAC-SHA256 of the
          raw body using this secret.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input name="url" type="url" required placeholder="https://your-erp.example.com/webhooks/rental" className="rounded border px-3 py-2 text-sm" />
      {state?.error && <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add webhook"}
      </button>
    </form>
  );
}
