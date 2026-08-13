import { redirect } from "next/navigation";
import { getSession, requirePlatformAdmin } from "@/app/lib/auth";
import { getAuditLog } from "@/app/lib/audit";

const ACTION_LABEL: Record<string, string> = {
  VIEW_ORG_DETAIL: "Viewed organization data",
  SUSPEND_ORG: "Suspended organization",
  REACTIVATE_ORG: "Reactivated organization",
};

export default async function PlatformAuditPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!requirePlatformAdmin(s)) redirect("/dashboard");

  const entries = await getAuditLog();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold">Platform admin audit log</h1>
        <p className="text-sm text-silver-dark">
          Every time a platform administrator views or acts on an organization's data, it's recorded here —
          append-only, and no organization's own staff can see or alter it.
        </p>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-silver-dark">
            <th className="py-2">When</th>
            <th className="py-2">Platform admin</th>
            <th className="py-2">Organization</th>
            <th className="py-2">Action</th>
            <th className="py-2">Detail</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b">
              <td className="py-2">{new Date(e.createdAt).toLocaleString()}</td>
              <td className="py-2">{e.platformAdmin.email ?? e.platformAdmin.phone}</td>
              <td className="py-2">{e.organization.name}</td>
              <td className="py-2">{ACTION_LABEL[e.action] ?? e.action}</td>
              <td className="py-2 text-silver-dark">{e.detail ?? "—"}</td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-silver-dark">
                No platform-admin activity recorded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
