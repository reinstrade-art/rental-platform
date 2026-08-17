import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { createVendor } from "@/app/lib/actions";
import { getOrgTier, hasFeature } from "@/app/lib/tier";

export default async function NewVendorPage() {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  if (!hasFeature(await getOrgTier(s.organizationId), "REPAIRS")) redirect("/dashboard");

  return (
    <div className="max-w-sm">
      <Link href="/repairs" className="text-xs underline text-silver-dark">
        Back to repairs
      </Link>
      <h1 className="mt-1 text-lg font-semibold">Add vendor</h1>
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
        <button type="submit" className="rounded bg-ink px-3 py-2 text-lily transition-colors hover:bg-ink-soft">
          Add vendor
        </button>
      </form>
    </div>
  );
}
