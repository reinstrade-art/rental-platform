"use client";

import { useActionState, useState } from "react";
import type { ApiKeyState } from "@/app/lib/actions";

export function CreateApiKeyForm({ action }: { action: (prev: ApiKeyState, fd: FormData) => Promise<ApiKeyState> }) {
  const [state, formAction, pending] = useActionState<ApiKeyState, FormData>(action, undefined);
  const [copied, setCopied] = useState(false);

  if (state?.rawKey) {
    const rawKey = state.rawKey;
    return (
      <div className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-800">
        <p className="font-medium">
          &quot;{state.name}&quot; created — copy this key now, it won&apos;t be shown again:
        </p>
        <div className="mt-2 flex items-stretch gap-2">
          <code className="block flex-1 break-all rounded border bg-lily px-2 py-1.5 font-mono text-xs text-ink">{rawKey}</code>
          <button
            type="button"
            onClick={async () => {
              // A pasted/typed key that's a character short or long is the
              // single most common reason a device's setup screen rejects
              // it -- a click here beats select-and-drag across a
              // monospace blob for getting every character exactly once.
              await navigator.clipboard.writeText(rawKey);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="shrink-0 rounded border border-green-300 bg-lily px-2 text-xs text-ink transition-colors hover:bg-silver-light"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input name="name" required placeholder="Key name (e.g. Accountant's ERP)" className="rounded border px-3 py-2 text-sm" />
      {state?.error && <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create API key"}
      </button>
    </form>
  );
}
