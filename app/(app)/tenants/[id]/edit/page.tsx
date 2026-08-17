import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { updateTenant } from "@/app/lib/actions";

export default async function EditTenantPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  const { id } = await params;
  const tenant = await prisma.tenant.findFirst({ where: { id, organizationId: s.organizationId } });
  if (!tenant) notFound();

  return (
    <div className="max-w-sm">
      <Link href="/tenants" className="text-xs underline text-silver-dark">
        All tenants
      </Link>
      <h1 className="mt-1 text-lg font-semibold">Edit tenant</h1>
      <form action={updateTenant.bind(null, tenant.id)} className="mt-4 flex flex-col gap-3">
        <input name="name" required defaultValue={tenant.name} placeholder="Full name" className="rounded border px-3 py-2" />
        <input name="phone" defaultValue={tenant.phone ?? ""} placeholder="Phone (optional)" className="rounded border px-3 py-2" />
        <input name="email" type="email" defaultValue={tenant.email ?? ""} placeholder="Email (optional)" className="rounded border px-3 py-2" />
        <button type="submit" className="rounded bg-ink px-3 py-2 text-lily transition-colors hover:bg-ink-soft">
          Save changes
        </button>
      </form>
    </div>
  );
}
