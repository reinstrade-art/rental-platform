import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getStaff, getProperties, getPendingInvitations, getActiveSessionCounts } from "@/app/lib/data";
import {
  inviteStaff,
  setStaffRole,
  setStaffPermissions,
  disableStaff,
  enableStaff,
  deleteStaffAction,
  revokeInvitationAction,
  impersonateAction,
  resetStaffPasswordAction,
} from "@/app/lib/actions";
import { DeleteButton } from "@/app/components/delete-button";
import { ResetPasswordForm } from "@/app/components/reset-password-form";
import { MODULE_LIST, MODULE_LABEL, parsePermissions } from "@/app/lib/constants";

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  const isAdmin = s.role === "ADMIN";
  const { error } = await searchParams;

  const [staff, properties, pendingInvitations, sessionCounts] = await Promise.all([
    getStaff(s.organizationId),
    isAdmin ? getProperties(s.organizationId) : Promise.resolve([]),
    isAdmin ? getPendingInvitations(s.organizationId) : Promise.resolve([]),
    isAdmin ? getActiveSessionCounts(s.organizationId) : Promise.resolve({} as Record<string, number>),
  ]);
  const propertyName = (id: string | null) => properties.find((p) => p.id === id)?.name ?? "—";

  return (
    <div className="flex flex-col gap-8">
      {error && <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div>
        <h1 className="text-lg font-semibold">Team</h1>
        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
              <th className="py-2">Email</th>
              <th className="py-2">Role</th>
              <th className="py-2">Property</th>
              <th className="py-2">Status</th>
              {isAdmin && <th className="py-2">Sessions</th>}
              {isAdmin && <th className="py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {staff.map((u) => (
              <tr key={u.id} className="border-b">
                <td className="py-2">{u.email ?? u.phone}</td>
                <td className="py-2">
                  {isAdmin && u.role !== "ADMIN" && u.role !== "CARETAKER" ? (
                    <form action={setStaffRole.bind(null, u.id, u.role === "MANAGER" ? "VIEWER" : "MANAGER")}>
                      <button className="text-xs underline">
                        {u.role} — switch to {u.role === "MANAGER" ? "VIEWER" : "MANAGER"}
                      </button>
                    </form>
                  ) : (
                    u.role
                  )}
                </td>
                <td className="py-2">{u.property?.name ?? "—"}</td>
                <td className="py-2">{u.disabledAt ? "Disabled" : "Active"}</td>
                {isAdmin && (
                  <td className="py-2">
                    <Link href={`/users/${u.id}/sessions`} className="text-xs underline">
                      {sessionCounts[u.id] ?? 0}
                    </Link>
                  </td>
                )}
                {isAdmin && (
                  <td className="py-2 flex flex-wrap items-start gap-2">
                    {u.id !== s.userId && u.role !== "ADMIN" && (
                      <>
                        {u.disabledAt ? (
                          <form action={enableStaff.bind(null, u.id)}>
                            <button className="text-xs underline text-green-700">Enable</button>
                          </form>
                        ) : (
                          <>
                            <form action={impersonateAction.bind(null, u.id)}>
                              <button className="text-xs underline">Sign in as</button>
                            </form>
                            <ResetPasswordForm userId={u.id} action={resetStaffPasswordAction} />
                            <form action={disableStaff.bind(null, u.id)}>
                              <button className="text-xs underline text-red-700">Disable</button>
                            </form>
                          </>
                        )}
                        <form action={deleteStaffAction.bind(null, u.id)}>
                          <DeleteButton confirmText={`Delete ${u.email ?? u.phone}? This cannot be undone.`} />
                        </form>
                        {(u.role === "MANAGER" || u.role === "VIEWER") && (
                          <details className="w-full basis-full">
                            <summary className="cursor-pointer text-xs underline">Permissions</summary>
                            {(() => {
                              const current = parsePermissions(u.permissions);
                              return (
                                <form
                                  action={setStaffPermissions.bind(null, u.id)}
                                  className="mt-2 flex flex-col gap-1.5 rounded border p-2"
                                >
                                  <label className="flex items-center gap-2 text-xs font-medium">
                                    <input type="checkbox" name="fullAccess" defaultChecked={current === null} />
                                    Full access
                                  </label>
                                  <div className="ml-1 grid grid-cols-2 gap-1 border-t pt-1.5 sm:grid-cols-3">
                                    {MODULE_LIST.map((m) => (
                                      <label key={m} className="flex items-center gap-1.5 text-xs">
                                        <input
                                          type="checkbox"
                                          name={`module_${m}`}
                                          defaultChecked={current === null || current.includes(m)}
                                        />
                                        {MODULE_LABEL[m]}
                                      </label>
                                    ))}
                                  </div>
                                  <p className="text-xs text-silver-dark">
                                    Uncheck &quot;Full access&quot; to limit this account to only the modules ticked below.
                                  </p>
                                  <button type="submit" className="self-start rounded bg-ink px-2 py-1 text-xs text-lily">
                                    Save permissions
                                  </button>
                                </form>
                              );
                            })()}
                          </details>
                        )}
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin && pendingInvitations.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold">Pending invitations</h2>
          <table className="mt-3 w-full max-w-2xl border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink-soft bg-metal text-left text-xs font-semibold uppercase tracking-wide text-ink">
                <th className="py-2">Contact</th>
                <th className="py-2">Role</th>
                <th className="py-2">Property</th>
                <th className="py-2">Expires</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {pendingInvitations.map((inv) => {
                const expired = inv.expiresAt < new Date();
                return (
                  <tr key={inv.id} className="border-b">
                    <td className="py-2">{inv.email ?? inv.phone}</td>
                    <td className="py-2">{inv.role}</td>
                    <td className="py-2">{inv.role === "CARETAKER" ? propertyName(inv.propertyId) : "—"}</td>
                    <td className={`py-2 ${expired ? "text-red-600" : ""}`}>
                      {new Date(inv.expiresAt).toLocaleDateString()}
                      {expired ? " (expired)" : ""}
                    </td>
                    <td className="py-2">
                      <form action={revokeInvitationAction.bind(null, inv.id)}>
                        <button className="text-xs text-red-700 underline">Revoke</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isAdmin && (
        <div className="max-w-sm">
          <h2 className="text-lg font-semibold">Invite a teammate</h2>
          <p className="text-xs text-silver-dark">
            New Viewer/Manager invites can see and act on everything in the org, and need an email address. A
            Caretaker only gets the Tenants module, scoped to the property you pick below — a phone number is
            enough for them, since email isn&apos;t in common use among caretakers.
          </p>
          <form action={inviteStaff} className="mt-3 flex flex-col gap-3">
            <input name="email" type="email" placeholder="Email (required for Viewer/Manager)" className="rounded border px-3 py-2" />
            <input name="phone" placeholder="Phone (Caretaker only)" className="rounded border px-3 py-2" />
            <select name="role" defaultValue="VIEWER" className="rounded border px-3 py-2">
              <option value="VIEWER">Viewer</option>
              <option value="MANAGER">Manager</option>
              <option value="CARETAKER">Caretaker</option>
            </select>
            <select name="propertyId" defaultValue="" className="rounded border px-3 py-2">
              <option value="" disabled>
                Property (Caretaker only)
              </option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded bg-ink px-3 py-2 text-lily transition-colors hover:bg-ink-soft">
              Send invite
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
