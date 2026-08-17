"use client";

/**
 * The one place a thrown Error from any server action or page lands, across
 * the whole app. Without this, Next's default is a blank "This page
 * couldn't load" screen with no message — and since this codebase's
 * standard validation pattern is a plain `throw new Error("readable
 * message")` from server actions (never an internal stack trace), that
 * message is exactly what a user needs to see and safe to show directly.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ink px-4 text-center">
      <div className="w-full max-w-sm rounded-lg border border-ink-soft border-t-2 border-t-gold bg-lily p-8 shadow-xl">
        <h1 className="text-lg font-semibold text-ink">Something went wrong</h1>
        <p className="mt-2 text-sm text-silver-dark">{error.message || "An unexpected error occurred."}</p>
        <button
          onClick={() => reset()}
          className="mt-6 w-full rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
