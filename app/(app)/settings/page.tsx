import { redirect } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { updateBranding } from "@/app/lib/actions";

export default async function SettingsPage() {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");

  const org = await prisma.organization.findUniqueOrThrow({ where: { id: s.organizationId } });

  return (
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
  );
}
