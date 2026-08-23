import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getSuppliers } from "@/app/lib/data";
import { createSupplier, deleteSupplier } from "@/app/lib/actions";
import { SUPPLIER_CATEGORIES } from "@/app/lib/constants";
import { getOrgTier, hasFeature } from "@/app/lib/tier";
import { DeleteButton } from "@/app/components/delete-button";

function label(s: string) {
  return s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  if (!hasFeature(await getOrgTier(s.organizationId), "SUPPLIERS")) redirect("/dashboard");
  const { error } = await searchParams;

  const suppliers = await getSuppliers(s.organizationId);

  return (
    <div className="flex flex-col gap-8">
      {error && <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div>
        <h1 className="text-lg font-semibold">Suppliers</h1>
        <p className="text-sm text-silver-dark">
          Where materials and building supplies are bought from — distinct from Vendors, who are paid for labour. A
          repair can name where its materials came from.
        </p>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
            <th className="py-2">Name</th>
            <th className="py-2">Category</th>
            <th className="py-2">Contact</th>
            <th className="py-2">Jobs supplied</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {suppliers.map((sup) => (
            <tr key={sup.id} className="border-b align-top">
              <td className="py-2 font-medium">
                <Link href={`/suppliers/${sup.id}`} className="underline">
                  {sup.name}
                </Link>
              </td>
              <td className="py-2">
                {label(sup.category)}
                {sup.itemDescription && (
                  <span className="block text-xs text-silver-dark">
                    {sup.itemDescription}
                    {sup.itemPrice != null && ` · ${money(sup.itemPrice)}`}
                  </span>
                )}
              </td>
              <td className="py-2">{[sup.contactName, sup.phone, sup.email].filter(Boolean).join(" · ") || "—"}</td>
              <td className="py-2">
                {sup.repairs.length === 0 ? (
                  <span className="text-xs text-silver-dark">none yet</span>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {sup.repairs.map((r) => (
                      <li key={r.id}>
                        <Link href={`/repairs/${r.id}`} className="text-xs underline">
                          {r.title}
                        </Link>
                        <span className="ml-1 text-xs text-silver-dark">
                          · {r.property.name}
                          {r.unit ? `, ${r.unit.label}` : ""} · {r.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td className="py-2">
                <div className="flex items-center justify-end gap-3">
                  <Link href={`/suppliers/${sup.id}/edit`} className="text-xs underline text-silver-dark">
                    Edit
                  </Link>
                  <form action={deleteSupplier.bind(null, sup.id)}>
                    <DeleteButton confirmText={`Delete ${sup.name}? This cannot be undone.`} />
                  </form>
                </div>
              </td>
            </tr>
          ))}
          {suppliers.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-silver-dark">
                No suppliers on file yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="max-w-sm">
        <h2 className="font-semibold">Add a supplier</h2>
        <form action={createSupplier} className="mt-3 flex flex-col gap-2">
          <input name="name" required placeholder="Name (e.g. Nakuru Hardware)" className="rounded border px-3 py-2 text-sm" />
          <select name="category" className="rounded border px-3 py-2 text-sm" defaultValue="GENERAL">
            {SUPPLIER_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {label(c)}
              </option>
            ))}
          </select>
          <input name="itemDescription" placeholder="What's bought here (e.g. 6-inch PVC pipe)" className="rounded border px-3 py-2 text-sm" />
          <input name="itemPrice" type="number" step="0.01" placeholder="Price (KES, optional)" className="rounded border px-3 py-2 text-sm" />
          <input name="contactName" placeholder="Contact person (optional)" className="rounded border px-3 py-2 text-sm" />
          <input name="phone" placeholder="Phone (optional)" className="rounded border px-3 py-2 text-sm" />
          <input name="email" type="email" placeholder="Email (optional)" className="rounded border px-3 py-2 text-sm" />
          <textarea name="notes" rows={2} placeholder="Notes (optional)" className="rounded border px-3 py-2 text-sm" />
          <button type="submit" className="rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
            Add supplier
          </button>
        </form>
      </div>
    </div>
  );
}
