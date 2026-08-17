import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getTenant, leaseBalance } from "@/app/lib/data";
import { deleteTenant, inviteTenant, replyToTenant } from "@/app/lib/actions";
import { DeleteButton } from "@/app/components/delete-button";

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default async function TenantDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  const { id } = await params;
  const { error } = await searchParams;
  const tenant = await getTenant(s.organizationId, id);
  if (!tenant) notFound();

  const totalOwed = tenant.leases
    .filter((l) => l.status === "ACTIVE")
    .reduce((sum, l) => sum + leaseBalance(l), 0);

  return (
    <div className="flex flex-col gap-8">
      {error && <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div>
        <Link href="/tenants" className="text-xs underline text-silver-dark">
          All tenants
        </Link>
        <div className="mt-1 flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold">{tenant.name}</h1>
            <p className="text-sm text-silver-dark">
              {[tenant.phone, tenant.email].filter(Boolean).join(" · ") || "No contact details on file"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href={`/leases/new?tenantId=${tenant.id}`} className="text-xs underline text-silver-dark">
              Add lease
            </Link>
            <Link href={`/tenants/${tenant.id}/edit`} className="text-xs underline text-silver-dark">
              Edit
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Leases</div>
          <div className="mt-1 text-xl font-semibold">{tenant.leases.length}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Active</div>
          <div className="mt-1 text-xl font-semibold">{tenant.leases.filter((l) => l.status === "ACTIVE").length}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">{totalOwed > 0 ? "Owed (active leases)" : "Balance"}</div>
          <div className={`mt-1 text-xl font-semibold ${totalOwed > 0 ? "text-red-600" : ""}`}>{money(totalOwed)}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Portal access</div>
          <div className="mt-1 text-sm font-semibold">
            {tenant.user ? (
              <span className="text-green-700">Registered</span>
            ) : (
              <form action={inviteTenant.bind(null, tenant.id)}>
                <button className="text-xs underline" disabled={!tenant.email && !tenant.phone}>
                  Invite to register
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      <div>
        <h2 className="font-semibold">Leases</h2>
        {tenant.leases.length === 0 ? (
          <p className="mt-2 text-sm text-silver-dark">
            No lease yet. <Link href={`/leases/new?tenantId=${tenant.id}`} className="underline">Create one</Link>.
          </p>
        ) : (
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
                <th className="py-2">Unit</th>
                <th className="py-2">Started</th>
                <th className="py-2">Status</th>
                <th className="py-2">Balance</th>
              </tr>
            </thead>
            <tbody>
              {tenant.leases.map((l) => {
                const balance = leaseBalance(l);
                return (
                  <tr key={l.id} className="border-b">
                    <td className="py-2">
                      <Link href={`/leases/${l.id}`} className="underline">
                        {l.unit.property.name} / {l.unit.label}
                      </Link>
                    </td>
                    <td className="py-2">{new Date(l.startDate).toLocaleDateString()}</td>
                    <td className={`py-2 ${l.status === "ACTIVE" ? "text-green-700" : "text-silver-dark"}`}>{l.status}</td>
                    <td className={`py-2 ${balance > 0 ? "text-red-600" : ""}`}>{money(balance)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="max-w-lg">
        <h2 className="font-semibold">Messages</h2>
        <p className="text-xs text-silver-dark">
          {tenant.user ? "The tenant sees this thread on their own portal page." : "This tenant has no portal login yet, so they cannot see replies."}
        </p>
        {tenant.messages.length === 0 ? (
          <p className="mt-3 text-sm text-silver-dark">Nothing yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {[...tenant.messages].reverse().map((m) => (
              <li key={m.id} className={`max-w-[85%] rounded border px-3 py-2 text-sm ${m.fromTenant ? "" : "ml-auto bg-silver-light"}`}>
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className="mt-1 text-xs text-silver-dark">
                  {m.fromTenant ? tenant.name : m.authorName} · {new Date(m.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
        <form action={replyToTenant.bind(null, tenant.id)} className="mt-3 flex flex-col gap-2">
          <textarea name="body" rows={2} required maxLength={2000} placeholder="Reply to the tenant…" className="rounded border px-3 py-2 text-sm" />
          <button type="submit" className="rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
            Send reply
          </button>
        </form>
      </div>

      {tenant.leases.length === 0 && !tenant.user && (
        <div className="max-w-sm border-t pt-6">
          <h2 className="font-semibold text-red-600">Delete tenant</h2>
          <p className="mt-1 text-xs text-silver-dark">
            {tenant.name} has no leases and no portal login, so this is safe to delete.
          </p>
          <form action={deleteTenant.bind(null, tenant.id)} className="mt-2">
            <DeleteButton confirmText={`Delete ${tenant.name}? This cannot be undone.`} />
          </form>
        </div>
      )}
    </div>
  );
}
