import { createVendor } from "@/app/lib/actions";

export default function NewVendorPage() {
  return (
    <div className="max-w-sm">
      <h1 className="text-lg font-semibold">Add vendor</h1>
      <form action={createVendor} className="mt-4 flex flex-col gap-3">
        <input name="name" required placeholder="Vendor / company name" className="rounded border px-3 py-2" />
        <input name="trade" placeholder="Trade (e.g. Plumbing)" className="rounded border px-3 py-2" />
        <input name="contactName" placeholder="Contact person (optional)" className="rounded border px-3 py-2" />
        <input name="phone" placeholder="Phone (optional)" className="rounded border px-3 py-2" />
        <input name="email" type="email" placeholder="Email (optional)" className="rounded border px-3 py-2" />
        <label className="flex items-center gap-2 text-sm">
          <input name="prequalified" type="checkbox" />
          Prequalified (office has vetted this vendor)
        </label>
        <button type="submit" className="rounded bg-black px-3 py-2 text-white">
          Add vendor
        </button>
      </form>
    </div>
  );
}
