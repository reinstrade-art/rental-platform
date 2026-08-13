import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getStaff } from "@/app/lib/data";
import { inviteStaff, setStaffRole, disableStaff, enableStaff, impersonateAction } from "@/app/lib/actions";

export default async function UsersPage() {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  const isAdmin = s.role === "ADMIN";

  const staff = await getStaff(s.organizationId);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold">Team</h1>
        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-silver-dark">
              <th className="py-2">Email</th>
              <th className="py-2">Role</th>
              <th className="py-2">Status</th>
              {isAdmin && <th className="py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {staff.map((u) => (
              <tr key={u.id} className="border-b">
                <td className="py-2">{u.email ?? u.phone}</td>
                <td className="py-2">
                  {isAdmin && u.role !== "ADMIN" ? (
                    <form action={setStaffRole.bind(null, u.id, u.role === "MANAGER" ? "VIEWER" : "MANAGER")}>
                      <button className="text-xs underline">
                        {u.role} — switch to {u.role === "MANAGER" ? "VIEWER" : "MANAGER"}
                      </button>
                    </form>
                  ) : (
                    u.role
                  )}
                </td>
                <td className="py-2">{u.disabledAt ? "Disabled" : "Active"}</td>
                {isAdmin && (
                  <td className="py-2 flex gap-2">
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
                            <form action={disableStaff.bind(null, u.id)}>
                              <button className="text-xs underline text-red-700">Disable</button>
                            </form>
                          </>
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

      {isAdmin && (
        <div className="max-w-sm">
          <h2 className="text-lg font-semibold">Invite a teammate</h2>
          <p className="text-xs text-silver-dark">New invites default to VIEWER — promote to MANAGER afterward if needed.</p>
          <form action={inviteStaff} className="mt-3 flex flex-col gap-3">
            <input name="email" type="email" required placeholder="Email" className="rounded border px-3 py-2" />
            <select name="role" defaultValue="VIEWER" className="rounded border px-3 py-2">
              <option value="VIEWER">Viewer</option>
              <option value="MANAGER">Manager</option>
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
