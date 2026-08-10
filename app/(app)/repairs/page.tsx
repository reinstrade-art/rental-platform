import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { getRepairs } from "@/app/lib/data";

const PRIORITY_COLOR: Record<string, string> = {
  URGENT: "text-red-600",
  HIGH: "text-orange-600",
  NORMAL: "",
  LOW: "text-gray-500",
};

export default async function RepairsPage() {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  const repairs = await getRepairs(s.organizationId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Repairs</h1>
        <Link href="/repairs/new" className="rounded bg-black px-3 py-1.5 text-sm text-white">
          Report repair
        </Link>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="py-2">Title</th>
            <th className="py-2">Property / Unit</th>
            <th className="py-2">Priority</th>
            <th className="py-2">Status</th>
            <th className="py-2">Vendor</th>
          </tr>
        </thead>
        <tbody>
          {repairs.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="py-2">
                <Link href={`/repairs/${r.id}`} className="underline">
                  {r.title}
                </Link>
              </td>
              <td className="py-2">
                {r.property.name}
                {r.unit ? ` / ${r.unit.label}` : ""}
              </td>
              <td className={`py-2 ${PRIORITY_COLOR[r.priority] ?? ""}`}>{r.priority}</td>
              <td className="py-2">{r.status}</td>
              <td className="py-2">{r.awardedVendor?.name ?? "—"}</td>
            </tr>
          ))}
          {repairs.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-gray-500">
                No repairs reported yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
