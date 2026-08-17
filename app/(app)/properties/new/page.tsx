import Link from "next/link";
import { createProperty } from "@/app/lib/actions";

export default function NewPropertyPage() {
  return (
    <div className="max-w-sm">
      <Link href="/properties" className="text-xs underline text-silver-dark">
        All properties
      </Link>
      <h1 className="mt-1 text-lg font-semibold">Add property</h1>
      <form action={createProperty} className="mt-4 flex flex-col gap-3">
        <input name="name" required placeholder="Property name" className="rounded border px-3 py-2" />
        <input name="address" placeholder="Address (optional)" className="rounded border px-3 py-2" />
        <button type="submit" className="rounded bg-ink px-3 py-2 text-lily transition-colors hover:bg-ink-soft">
          Add property
        </button>
      </form>
    </div>
  );
}
