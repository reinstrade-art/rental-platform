import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { requireModule } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import { updateTenant } from "@/app/lib/actions";

export default async function EditTenantPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  requireModule(s, "tenants");
  const { id } = await params;
  const { error } = await searchParams;
  const tenant = await prisma.tenant.findFirst({ where: { id, organizationId: s.organizationId } });
  if (!tenant) notFound();

  return (
    <div className="max-w-sm">
      <Link href={`/tenants/${tenant.id}`} className="text-xs underline text-silver-dark">
        Back to {tenant.name}
      </Link>
      <h1 className="mt-1 text-lg font-semibold">Edit tenant</h1>
      {error && <div className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
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
