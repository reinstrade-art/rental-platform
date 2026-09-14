import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { requireModule } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import { updateProperty } from "@/app/lib/actions";

export default async function EditPropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  requireModule(s, "properties");
  const { id } = await params;
  const { error } = await searchParams;
  const property = await prisma.property.findFirst({ where: { id, organizationId: s.organizationId } });
  if (!property) notFound();

  return (
    <div className="max-w-sm">
      <Link href={`/properties/${property.id}`} className="text-xs underline text-silver-dark">
        Back to {property.name}
      </Link>
      <h1 className="mt-1 text-lg font-semibold">Edit property</h1>
      {error && <div className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      <form action={updateProperty.bind(null, property.id)} className="mt-4 flex flex-col gap-3">
        <input name="name" required defaultValue={property.name} placeholder="Property name" className="rounded border px-3 py-2" />
        <input name="address" defaultValue={property.address ?? ""} placeholder="Address (optional)" className="rounded border px-3 py-2" />
        <button type="submit" className="rounded bg-ink px-3 py-2 text-lily transition-colors hover:bg-ink-soft">
          Save changes
        </button>
      </form>
    </div>
  );
}
