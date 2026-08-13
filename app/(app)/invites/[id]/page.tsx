import { redirect, notFound } from "next/navigation";
import { getSession, requireStaff } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

export default async function InviteConfirmationPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  const { id } = await params;

  const invite = await prisma.invitation.findFirst({ where: { id, organizationId: s.organizationId } });
  if (!invite) notFound();

  return (
    <div className="max-w-sm">
      <h1 className="text-lg font-semibold">Invitation created</h1>
      <p className="mt-2 text-sm text-silver-dark">
        Give this code to {invite.email ?? invite.phone}, along with the address/number it was issued to — they'll
        need both to register at <span className="font-mono">/register</span>.
      </p>
      <div className="mt-4 rounded border bg-silver-light p-4 text-center font-mono text-2xl tracking-widest">
        {invite.code}
      </div>
      <p className="mt-2 text-xs text-silver-dark">
        Role: {invite.role} · Expires {new Date(invite.expiresAt).toLocaleDateString()}
        {invite.usedAt ? ` · Already used ${new Date(invite.usedAt).toLocaleDateString()}` : ""}
      </p>
    </div>
  );
}
