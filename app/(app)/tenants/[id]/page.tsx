import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { headers } from "next/headers";
import { getSession, requireTenantsAccess, isCaretaker } from "@/app/lib/auth";
import { getTenant, leaseBalance } from "@/app/lib/data";
import { deleteTenant, inviteTenant, replyToTenant } from "@/app/lib/actions";
import { sendMpesaPrompt } from "@/app/lib/mpesa-actions";
import { mpesaConfigured } from "@/app/lib/mpesa";
import { prisma } from "@/app/lib/prisma";
import { DeleteButton } from "@/app/components/delete-button";
import { RichTextEditor } from "@/app/components/rich-text-editor";
import { MpesaPay } from "@/app/components/mpesa-pay";
import { waLink } from "@/app/lib/phone";

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
  if (!requireTenantsAccess(s)) redirect("/login");
  const caretaker = isCaretaker(s.role);
  const { id } = await params;
  const { error } = await searchParams;
  const tenant = await getTenant(s.organizationId, id, caretaker ? (s.propertyId ?? undefined) : undefined);
  if (!tenant) notFound();

  const totalOwed = tenant.leases
    .filter((l) => l.status === "ACTIVE")
    .reduce((sum, l) => sum + leaseBalance(l), 0);

  const activeLease = tenant.leases.find((l) => l.status === "ACTIVE") ?? null;
  const org = !caretaker && activeLease ? await prisma.organization.findUnique({ where: { id: s.organizationId } }) : null;

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${h.get("host")}`;
  const firstName = tenant.name.split(" ")[0];
  const mpesaReady = Boolean(
    org &&
      mpesaConfigured({
        env: org.mpesaEnv,
        shortcode: org.mpesaShortcode,
        accountType: org.mpesaAccountType,
        consumerKey: org.mpesaConsumerKey,
        consumerSecret: org.mpesaConsumerSecret,
        passkey: org.mpesaPasskey,
      }),
  );

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
          {!caretaker && (
            <div className="flex items-center gap-3">
              <Link href={`/leases/new?tenantId=${tenant.id}`} className="text-xs underline text-silver-dark">
                Add lease
              </Link>
              <Link href={`/tenants/${tenant.id}/edit`} className="text-xs underline text-silver-dark">
                Edit
              </Link>
            </div>
          )}
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
            ) : caretaker ? (
              <span className="text-silver-dark">—</span>
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

      {activeLease && mpesaReady && (
        <div className="max-w-xs">
          <h2 className="font-semibold">Send M-Pesa prompt</h2>
          <p className="text-xs text-silver-dark">Raises the payment prompt straight to {tenant.name.split(" ")[0]}&apos;s phone.</p>
          <div className="mt-2">
            <MpesaPay
              action={sendMpesaPrompt}
              leaseId={activeLease.id}
              defaultAmount={leaseBalance(activeLease) > 0 ? leaseBalance(activeLease) : activeLease.monthlyRent}
              phone={tenant.phone}
              editablePhone
            />
          </div>
        </div>
      )}

      <div>
        <h2 className="font-semibold">Leases</h2>
        {tenant.leases.length === 0 ? (
          <p className="mt-2 text-sm text-silver-dark">
            No lease yet.
            {!caretaker && (
              <>
                {" "}
                <Link href={`/leases/new?tenantId=${tenant.id}`} className="underline">
                  Create one
                </Link>
                .
              </>
            )}
          </p>
        ) : (
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
                <th className="py-2">Unit</th>
                <th className="py-2">Started</th>
                <th className="py-2">Status</th>
                <th className="py-2">Balance</th>
                <th className="py-2">Agreement</th>
              </tr>
            </thead>
            <tbody>
              {tenant.leases.map((l) => {
                const balance = leaseBalance(l);
                const agreementWa = waLink(tenant.phone, `Dear ${firstName}, here is your tenancy agreement: ${origin}/api/agreement/${l.id}`);
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
                    <td className="py-2">
                      <div className="flex flex-col gap-0.5">
                        <span className={`text-xs ${l.signedAt ? "text-green-700" : "text-silver-dark"}`}>
                          {l.signedAt ? `Signed ${new Date(l.signedAt).toLocaleDateString()}` : "Not yet signed"}
                        </span>
                        <div className="flex items-center gap-2">
                          <a href={`/api/agreement/${l.id}`} target="_blank" rel="noreferrer" className="text-xs underline">
                            View / print
                          </a>
                          {agreementWa && (
                            <a href={agreementWa} target="_blank" rel="noreferrer" className="text-xs underline text-silver-dark">
                              WhatsApp
                            </a>
                          )}
                        </div>
                      </div>
                    </td>
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
                <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: m.body }} />
                {m.attachments.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {m.attachments.map((a) => (
                      <li key={a.id}>
                        <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" className="text-xs underline">
                          📎 {a.filename} ({Math.round(a.size / 1024)}KB)
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1 text-xs text-silver-dark">
                  {m.fromTenant ? tenant.name : m.authorName} · {new Date(m.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
        <form action={replyToTenant.bind(null, tenant.id)} encType="multipart/form-data" className="mt-3 flex flex-col gap-2">
          <RichTextEditor name="body" placeholder="Reply to the tenant…" />
          <input name="attachments" type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" className="text-xs" />
          <button type="submit" className="self-start rounded bg-ink px-3 py-2 text-sm text-lily transition-colors hover:bg-ink-soft">
            Send reply
          </button>
        </form>
      </div>

      {!caretaker && tenant.leases.length === 0 && !tenant.user && (
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
