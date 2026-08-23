import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSession, requireOrgAdmin, deviceLabel } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { getUserSessions } from "@/app/lib/data";
import { revokeTeammateSessionAction, revokeAllTeammateSessionsAction } from "@/app/lib/actions";

export default async function TeammateSessionsPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!requireOrgAdmin(s)) redirect("/login");

  const { id } = await params;
  const user = await prisma.user.findFirst({ where: { id, organizationId: s.organizationId } });
  if (!user) notFound();

  const sessions = await getUserSessions(id);

  return (
    <div className="max-w-lg">
      <Link href="/users" className="text-xs underline text-silver-dark">
        Team
      </Link>
      <div className="mt-1 flex items-center justify-between">
        <h1 className="text-lg font-semibold">{user.email ?? user.phone}&apos;s sessions</h1>
        {sessions.length > 0 && (
          <form action={revokeAllTeammateSessionsAction.bind(null, user.id)}>
            <button className="text-xs text-red-700 underline">Sign out everywhere</button>
          </form>
        )}
      </div>
      <p className="mt-1 text-xs text-silver-dark">
        Every device this account is currently signed in on — for a shared computer left logged in, or a device
        that&apos;s gone missing.
      </p>

      {sessions.length === 0 ? (
        <p className="mt-4 text-sm text-silver-dark">Not signed in anywhere right now.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {sessions.map((sess) => (
            <li key={sess.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <div>
                <div>{deviceLabel(sess.userAgent)}</div>
                <div className="text-xs text-silver-dark">
                  Signed in {new Date(sess.createdAt).toLocaleDateString()} · last active{" "}
                  {new Date(sess.lastSeenAt).toLocaleDateString()}
                  {sess.ip ? ` · ${sess.ip}` : ""}
                </div>
              </div>
              <form action={revokeTeammateSessionAction.bind(null, user.id, sess.id)}>
                <button className="text-xs text-red-700 underline">Sign out</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
