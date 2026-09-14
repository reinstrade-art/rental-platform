import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { requireModule } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import { updateVendor } from "@/app/lib/actions";
import { getOrgTier, hasFeature } from "@/app/lib/tier";

export default async function EditVendorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  if (!hasFeature(await getOrgTier(s.organizationId), "REPAIRS")) redirect("/home");
  requireModule(s, "vendors");

  const { id } = await params;
  const { error } = await searchParams;
  const vendor = await prisma.vendor.findFirst({ where: { id, organizationId: s.organizationId } });
  if (!vendor) notFound();

  return (
    <div className="max-w-sm">
      <Link href={`/vendors/${vendor.id}`} className="text-xs underline text-silver-dark">
        Back to {vendor.name}
      </Link>
      <h1 className="mt-1 text-lg font-semibold">Edit vendor</h1>
      {error && <div className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      <form action={updateVendor.bind(null, vendor.id)} className="mt-4 flex flex-col gap-3">
        <input name="name" required defaultValue={vendor.name} placeholder="Vendor / company name" className="rounded border px-3 py-2" />
        <input name="trade" defaultValue={vendor.trade ?? ""} placeholder="Trade (e.g. Plumbing)" className="rounded border px-3 py-2" />
        <input name="contactName" defaultValue={vendor.contactName ?? ""} placeholder="Contact person (optional)" className="rounded border px-3 py-2" />
        <input name="phone" defaultValue={vendor.phone ?? ""} placeholder="Phone (optional)" className="rounded border px-3 py-2" />
        <input name="email" type="email" defaultValue={vendor.email ?? ""} placeholder="Email (optional)" className="rounded border px-3 py-2" />
        <textarea name="notes" rows={2} defaultValue={vendor.notes ?? ""} placeholder="Notes (optional)" className="rounded border px-3 py-2" />
        <button type="submit" className="rounded bg-ink px-3 py-2 text-lily transition-colors hover:bg-ink-soft">
          Save changes
        </button>
      </form>
    </div>
  );
}
