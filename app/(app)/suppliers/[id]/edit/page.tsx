import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { updateSupplier } from "@/app/lib/actions";
import { SUPPLIER_CATEGORIES } from "@/app/lib/constants";
import { getOrgTier, hasFeature } from "@/app/lib/tier";

function label(s: string) {
  return s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  if (!hasFeature(await getOrgTier(s.organizationId), "SUPPLIERS")) redirect("/dashboard");

  const { id } = await params;
  const supplier = await prisma.supplier.findFirst({ where: { id, organizationId: s.organizationId } });
  if (!supplier) notFound();

  return (
    <div className="max-w-sm">
      <Link href="/suppliers" className="text-xs underline text-silver-dark">
        All suppliers
      </Link>
      <h1 className="mt-1 text-lg font-semibold">Edit supplier</h1>
      <form action={updateSupplier.bind(null, supplier.id)} className="mt-4 flex flex-col gap-3">
        <input name="name" required defaultValue={supplier.name} placeholder="Name" className="rounded border px-3 py-2" />
        <select name="category" defaultValue={supplier.category} className="rounded border px-3 py-2">
          {SUPPLIER_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {label(c)}
            </option>
          ))}
        </select>
        <input name="itemDescription" defaultValue={supplier.itemDescription ?? ""} placeholder="What's bought here" className="rounded border px-3 py-2" />
        <input name="itemPrice" type="number" step="0.01" defaultValue={supplier.itemPrice ?? ""} placeholder="Price (KES, optional)" className="rounded border px-3 py-2" />
        <input name="contactName" defaultValue={supplier.contactName ?? ""} placeholder="Contact person (optional)" className="rounded border px-3 py-2" />
        <input name="phone" defaultValue={supplier.phone ?? ""} placeholder="Phone (optional)" className="rounded border px-3 py-2" />
        <input name="email" type="email" defaultValue={supplier.email ?? ""} placeholder="Email (optional)" className="rounded border px-3 py-2" />
        <textarea name="notes" rows={2} defaultValue={supplier.notes ?? ""} placeholder="Notes (optional)" className="rounded border px-3 py-2" />
        <button type="submit" className="rounded bg-ink px-3 py-2 text-lily transition-colors hover:bg-ink-soft">
          Save changes
        </button>
      </form>
    </div>
  );
}
