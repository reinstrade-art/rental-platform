import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession, requirePlatformAdmin } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { logPlatformAccess } from "@/app/lib/audit";

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default async function PlatformPropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string; propertyId: string }>;
}) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!requirePlatformAdmin(s)) redirect("/dashboard");

  const { id, propertyId } = await params;
  const property = await prisma.property.findFirst({
    where: { id: propertyId, organizationId: id },
    include: {
      units: {
        include: {
          leases: { include: { tenant: true }, orderBy: { createdAt: "desc" } },
        },
      },
      organization: { select: { name: true } },
    },
  });
  if (!property) notFound();

  await logPlatformAccess(s.userId, id, "VIEW_ORG_DETAIL", `Viewed property ${property.name} by ${s.email ?? s.userId}`);

  const leases = property.units.flatMap((u) => u.leases.map((l) => ({ ...l, unit: u })));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/platform/${id}`} className="text-xs underline text-silver-dark">
          {property.organization.name}
        </Link>
        <h1 className="mt-1 text-lg font-semibold">{property.name}</h1>
        <p className="text-sm text-silver-dark">{property.address ?? "No address on file"}</p>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
            <th className="py-1">Tenant</th>
            <th className="py-1">Unit</th>
            <th className="py-1">Monthly rent</th>
            <th className="py-1">Status</th>
          </tr>
        </thead>
        <tbody>
          {leases.map((l) => (
            <tr key={l.id} className="border-b">
              <td className="py-1">{l.tenant.name}</td>
              <td className="py-1">{l.unit.label}</td>
              <td className="py-1">{money(l.monthlyRent)}</td>
              <td className="py-1">{l.status}</td>
            </tr>
          ))}
          {leases.length === 0 && (
            <tr>
              <td colSpan={4} className="py-4 text-silver-dark">
                No leases yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
