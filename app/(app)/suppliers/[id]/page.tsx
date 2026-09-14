import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getSupplier } from "@/app/lib/data";
import { deleteSupplier } from "@/app/lib/actions";
import { DeleteButton } from "@/app/components/delete-button";
import { getOrgTier, hasFeature } from "@/app/lib/tier";
import { requireModule } from "@/app/lib/permissions";

function label(s: string) {
  return s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  if (!hasFeature(await getOrgTier(s.organizationId), "SUPPLIERS")) redirect("/home");
  requireModule(s, "suppliers");
  const { id } = await params;
  const supplier = await getSupplier(s.organizationId, id);
  if (!supplier) notFound();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/suppliers" className="text-xs underline text-silver-dark">
          All suppliers
        </Link>
        <div className="mt-1 flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold">{supplier.name}</h1>
            <p className="text-sm text-silver-dark">
              {label(supplier.category)}
              {[supplier.contactName, supplier.phone, supplier.email].filter(Boolean).length > 0
                ? ` · ${[supplier.contactName, supplier.phone, supplier.email].filter(Boolean).join(" · ")}`
                : ""}
            </p>
          </div>
          <Link href={`/suppliers/${supplier.id}/edit`} className="text-xs underline text-silver-dark">
            Edit
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Jobs supplied</div>
          <div className="mt-1 text-xl font-semibold">{supplier.repairs.length}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Typical item</div>
          <div className="mt-1 text-sm font-semibold">{supplier.itemDescription ?? "—"}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Typical price</div>
          <div className="mt-1 text-xl font-semibold">{supplier.itemPrice != null ? money(supplier.itemPrice) : "—"}</div>
        </div>
      </div>

      <div>
        <h2 className="font-semibold">Jobs supplied</h2>
        {supplier.repairs.length === 0 ? (
          <p className="mt-2 text-sm text-silver-dark">No jobs have used this supplier yet.</p>
        ) : (
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
                <th className="py-1">Job</th>
                <th className="py-1">Property</th>
                <th className="py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {supplier.repairs.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="py-1">
                    <Link href={`/repairs/${r.id}`} className="underline">
                      {r.title}
                    </Link>
                  </td>
                  <td className="py-1">
                    {r.property.name}
                    {r.unit ? ` / ${r.unit.label}` : ""}
                  </td>
                  <td className="py-1">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {supplier.notes && (
        <div className="max-w-lg">
          <h2 className="font-semibold">Notes</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm text-silver-dark">{supplier.notes}</p>
        </div>
      )}

      <div className="max-w-sm border-t pt-6">
        <h2 className="font-semibold text-red-600">Delete supplier</h2>
        <p className="mt-1 text-xs text-silver-dark">
          Jobs that named {supplier.name} keep their history — only the assignment is cleared.
        </p>
        <form action={deleteSupplier.bind(null, supplier.id)} className="mt-2">
          <DeleteButton confirmText={`Delete ${supplier.name}? This cannot be undone.`} />
        </form>
      </div>
    </div>
  );
}
