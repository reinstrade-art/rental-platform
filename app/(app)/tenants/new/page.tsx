import { createTenant } from "@/app/lib/actions";

export default function NewTenantPage() {
  return (
    <div className="max-w-sm">
      <h1 className="text-lg font-semibold">Add tenant</h1>
      <form action={createTenant} className="mt-4 flex flex-col gap-3">
        <input name="name" required placeholder="Full name" className="rounded border px-3 py-2" />
        <input name="phone" placeholder="Phone (optional)" className="rounded border px-3 py-2" />
        <input name="email" type="email" placeholder="Email (optional)" className="rounded border px-3 py-2" />
        <button type="submit" className="rounded bg-black px-3 py-2 text-white">
          Add tenant
        </button>
      </form>
    </div>
  );
}
