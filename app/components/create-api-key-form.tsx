"use client";

import { useActionState } from "react";
import type { ApiKeyState } from "@/app/lib/actions";

export function CreateApiKeyForm({ action }: { action: (prev: ApiKeyState, fd: FormData) => Promise<ApiKeyState> }) {
  const [state, formAction, pending] = useActionState<ApiKeyState, FormData>(action, undefined);

  if (state?.rawKey) {
    return (
      <div className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-800">
        <p className="font-medium">
          &quot;{state.name}&quot; created — copy this key now, it won&apos;t be shown again:
        </p>
        <code className="mt-2 block break-all rounded border bg-lily px-2 py-1.5 font-mono text-xs text-ink">{state.rawKey}</code>
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
