import { redirect, notFound } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { updateProperty } from "@/app/lib/actions";

export default async function EditPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  const { id } = await params;
  const property = await prisma.property.findFirst({ where: { id, organizationId: s.organizationId } });
  if (!property) notFound();

  return (
    <div className="max-w-sm">
      <h1 className="text-lg font-semibold">Edit property</h1>
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
