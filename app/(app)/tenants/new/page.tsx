import Link from "next/link";
import { createTenant } from "@/app/lib/actions";

export default async function NewTenantPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="max-w-sm">
      <Link href="/tenants" className="text-xs underline text-silver-dark">
        All tenants
      </Link>
      <h1 className="mt-1 text-lg font-semibold">Add tenant</h1>
      <p className="mt-1 text-xs text-silver-dark">
        For someone not yet in the system — a new prospective tenant. Fill in what you know and, if you have a
        phone or email for them, tick the box below to send their registration invite immediately.
      </p>
      {error && <div className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      <form action={createTenant} className="mt-4 flex flex-col gap-3">
        <input name="name" required placeholder="Full name" className="rounded border px-3 py-2" />
        <input name="phone" placeholder="Phone (optional)" className="rounded border px-3 py-2" />
        <input name="email" type="email" placeholder="Email (optional)" className="rounded border px-3 py-2" />
        <label className="flex items-start gap-2 text-xs text-silver-dark">
          <input type="checkbox" name="inviteNow" className="mt-0.5" />
          Also send a registration invite now (needs a phone or email above)
        </label>
        <button type="submit" className="rounded bg-ink px-3 py-2 text-lily transition-colors hover:bg-ink-soft">
          Add tenant
        </button>
      </form>
    </div>
  );
}
