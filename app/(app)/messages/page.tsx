import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getMessageThreads } from "@/app/lib/data";
import { replyToTenant } from "@/app/lib/actions";

export default async function MessagesPage() {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");

  const threads = await getMessageThreads(s.organizationId);
  const waiting = threads.filter((t) => t.waiting).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Messages</h1>
        <p className="text-sm text-silver-dark">Conversations with tenants — those waiting on a reply come first.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Awaiting a reply</div>
          <div className={`mt-1 text-xl font-semibold ${waiting ? "text-orange-600" : ""}`}>{waiting}</div>
          <div className="text-xs text-silver-dark">Tenant wrote last</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Conversations</div>
          <div className="mt-1 text-xl font-semibold">{threads.length}</div>
        </div>
        <div className="rounded border p-4">
          <div className="text-xs text-silver-dark">Messages</div>
          <div className="mt-1 text-xl font-semibold">{threads.reduce((s, t) => s + t.tenant.messages.length, 0)}</div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {threads.length === 0 && <p className="text-sm text-silver-dark">No messages yet.</p>}
        {threads.map(({ tenant, last, waiting: owed, lease }) => (
          <div key={tenant.id} className={`rounded border p-4 ${owed ? "border-orange-300 bg-orange-50" : ""}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">
                <Link href={`/tenants/${tenant.id}/edit`} className="underline">
                  {tenant.name}
                </Link>
                {lease && (
                  <span className="ml-2 text-xs font-normal text-silver-dark">
                    {lease.unit.property.name} · {lease.unit.label}
                  </span>
                )}
              </h2>
              {owed && (
                <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
                  waiting since {new Date(last.createdAt).toLocaleDateString()}
                </span>
              )}
            </div>

            <ul className="mt-3 flex flex-col gap-2">
              {tenant.messages.slice(-4).map((msg) => (
                <li
                  key={msg.id}
                  className={`max-w-[85%] rounded border px-3 py-2 text-sm ${msg.fromTenant ? "" : "ml-auto bg-silver-light"}`}
                >
                  <p className="whitespace-pre-wrap">{msg.body}</p>
                  <p className="mt-1 text-xs text-silver-dark">
                    {msg.fromTenant ? tenant.name : msg.authorName} · {new Date(msg.createdAt).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>

            <form action={replyToTenant.bind(null, tenant.id)} className="mt-3 flex flex-col gap-2 border-t pt-3">
              <textarea
                name="body"
                rows={2}
                required
                maxLength={2000}
                placeholder={`Reply to ${tenant.name.split(" ")[0]}…`}
                className="rounded border px-3 py-2 text-sm"
              />
              <button type="submit" className="self-start rounded bg-ink px-3 py-1.5 text-sm text-lily transition-colors hover:bg-ink-soft">
                Send reply
              </button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
