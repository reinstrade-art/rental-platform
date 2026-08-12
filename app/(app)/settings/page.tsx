import { redirect } from "next/navigation";
import { getSession, requireStaff, deviceLabel } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { getOwnOtherSessions } from "@/app/lib/data";
import { updateBranding, revokeSessionAction, revokeOtherSessionsAction } from "@/app/lib/actions";

export default async function SettingsPage() {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");

  const org = await prisma.organization.findUniqueOrThrow({ where: { id: s.organizationId } });
  const sessions = await getOwnOtherSessions(s.userId);

  return (
    <div className="flex flex-col gap-10">
    <div className="max-w-sm">
      <h1 className="text-lg font-semibold">Document branding</h1>
      <p className="mt-1 text-sm text-gray-500">
        Shown on the letterhead of receipts and invoices sent to tenants and tradesmen. Falls back to your
        organization name if left blank.
      </p>
      <form action={updateBranding} className="mt-4 flex flex-col gap-3">
        <input
          name="letterheadName"
          defaultValue={org.letterheadName ?? ""}
          placeholder={org.name}
          className="rounded border px-3 py-2"
        />
        <input
          name="letterheadAddress"
          defaultValue={org.letterheadAddress ?? ""}
          placeholder="Address"
          className="rounded border px-3 py-2"
        />
        <input
          name="letterheadPhone"
          defaultValue={org.letterheadPhone ?? ""}
          placeholder="Phone"
          className="rounded border px-3 py-2"
        />
        <input
          name="letterheadEmail"
          defaultValue={org.letterheadEmail ?? ""}
          placeholder="Email"
          className="rounded border px-3 py-2"
        />

        <label className="mt-2 flex items-center gap-3 text-sm">
          <span className="text-gray-600">Brand color</span>
          <input
            type="color"
            name="brandColor"
            defaultValue={org.brandColor ?? "#1E3350"}
            className="h-9 w-14 cursor-pointer rounded border"
          />
        </label>
        <p className="text-xs text-gray-500">
          Used for the band/rail color on receipts and invoices — every organization gets its own look from the
          same template, not a shared default.
        </p>

        <button type="submit" className="rounded bg-black px-3 py-2 text-white">
          Save
        </button>
      </form>
    </div>

    <div className="max-w-md">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Other devices signed in</h2>
        {sessions.length > 0 && (
          <form action={revokeOtherSessionsAction}>
            <button className="text-xs text-red-700 underline">Sign out of all of them</button>
          </form>
        )}
      </div>
      {sessions.length === 0 ? (
        <p className="mt-2 text-xs text-gray-500">Nothing else — this is the only place you're signed in.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {sessions.map((sess) => (
            <li key={sess.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
              <div>
                <div>{deviceLabel(sess.userAgent)}</div>
                <div className="text-xs text-gray-500">
                  Signed in {new Date(sess.createdAt).toLocaleDateString()} · last active{" "}
                  {new Date(sess.lastSeenAt).toLocaleDateString()}
                  {sess.ip ? ` · ${sess.ip}` : ""}
                </div>
              </div>
              <form action={revokeSessionAction}>
                <input type="hidden" name="sessionId" value={sess.id} />
                <button className="text-xs text-red-700 underline">Sign out</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
    </div>
  );
}
