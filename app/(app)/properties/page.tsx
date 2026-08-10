import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getProperties } from "@/app/lib/data";

export default async function PropertiesPage() {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  const properties = await getProperties(s.organizationId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Properties</h1>
        <Link href="/properties/new" className="rounded bg-black px-3 py-1.5 text-sm text-white">
          Add property
        </Link>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="py-2">Name</th>
            <th className="py-2">Address</th>
            <th className="py-2">Units</th>
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
            </tr>
          ))}
          {properties.length === 0 && (
            <tr>
              <td colSpan={3} className="py-4 text-gray-500">
                No properties yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
