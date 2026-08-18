import { redirect, notFound } from "next/navigation";
import { headers } from "next/headers";
import { getSession, requireStaff } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { waLink } from "@/app/lib/phone";

export default async function InviteConfirmationPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!requireStaff(s)) redirect("/login");
  const { id } = await params;

  const invite = await prisma.invitation.findFirst({ where: { id, organizationId: s.organizationId } });
  if (!invite) notFound();

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${h.get("host")}`;
  const wa = waLink(
    invite.phone,
    `Hi, please register your account here: ${origin}/register — your invitation code is ${invite.code}. It expires ${new Date(invite.expiresAt).toLocaleDateString()}.`,
  );

  return (
    <div className="max-w-sm">
      <h1 className="text-lg font-semibold">Invitation created</h1>
      <p className="mt-2 text-sm text-silver-dark">
        Give this code to {invite.email ?? invite.phone}, along with the address/number it was issued to — they&apos;ll
        need both to register at <span className="font-mono">/register</span>.
      </p>
      <div className="mt-4 rounded border bg-silver-light p-4 text-center font-mono text-2xl tracking-widest">
        {invite.code}
      </div>
      {wa && (
        <a
          href={wa}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block rounded border px-3 py-1.5 text-sm transition-colors hover:bg-silver-light"
        >
          Send on WhatsApp
        </a>
      )}
      <p className="mt-2 text-xs text-silver-dark">
        Role: {invite.role} · Expires {new Date(invite.expiresAt).toLocaleDateString()}
        {invite.usedAt ? ` · Already used ${new Date(invite.usedAt).toLocaleDateString()}` : ""}
      </p>
    </div>
  );
}
