import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getProperties } from "@/app/lib/data";
import { deleteProperty, importPropertiesCsv } from "@/app/lib/actions";
import { DeleteButton } from "@/app/components/delete-button";
import { getOrgTier, hasFeature } from "@/app/lib/tier";

export default async function PropertiesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  const properties = await getProperties(s.organizationId);
  const canImport = hasFeature(await getOrgTier(s.organizationId), "CSV_IMPORT");
  const { error } = await searchParams;

  return (
    <div className="flex flex-col gap-8">
      {error && <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Properties</h1>
        <Link href="/properties/new" className="rounded bg-ink px-3 py-1.5 text-sm text-lily transition-colors hover:bg-ink-soft">
          Add property
        </Link>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
            <th className="py-2">Name</th>
            <th className="py-2">Address</th>
            <th className="py-2">Units</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {properties.map((p) => (
            <tr key={p.id} className="border-b">
              <td className="py-2">
                <Link href={`/properties/${p.id}`} className="underline">
                  {p.name}
                </Link>
              </td>
              <td className="py-2">{p.address ?? "—"}</td>
              <td className="py-2">{p.units.length}</td>
              <td className="py-2">
                <div className="flex items-center justify-end gap-3">
                  <Link href={`/properties/${p.id}/edit`} className="text-xs underline text-silver-dark">
                    Edit
                  </Link>
                  <form action={deleteProperty.bind(null, p.id)}>
                    <DeleteButton confirmText={`Delete ${p.name}? This cannot be undone.`} />
                  </form>
                </div>
              </td>
            </tr>
          ))}
          {properties.length === 0 && (
            <tr>
              <td colSpan={4} className="py-4 text-silver-dark">
                No properties yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {canImport && (
        <div className="max-w-sm">
          <h2 className="font-semibold">Import a CSV</h2>
          <p className="text-xs text-silver-dark">One row per property: name,address</p>
          <form action={importPropertiesCsv} className="mt-3 flex flex-col gap-2" encType="multipart/form-data">
            <input name="file" type="file" accept=".csv,text/csv" required className="rounded border px-3 py-2 text-sm" />
            <button type="submit" className="rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
              Import
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
