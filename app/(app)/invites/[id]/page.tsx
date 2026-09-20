import { redirect, notFound } from "next/navigation";
import { headers } from "next/headers";
import { getSession, requireTenantsAccess } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { waLink } from "@/app/lib/phone";
import { canViewTenantDetails, MASK } from "@/app/lib/pii";

export default async function InviteConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ emailSent?: string; whatsappSent?: string }>;
}) {
  const s = await getSession();
  if (!requireTenantsAccess(s)) redirect("/login");
  const { id } = await params;
  const { emailSent, whatsappSent } = await searchParams;

  const invite = await prisma.invitation.findFirst({ where: { id, organizationId: s.organizationId } });
  if (!invite) notFound();
  // A caretaker's access to this page is scoped to the one invite flow they
  // can actually raise — a tenant invite. Anything else (a staff invite
  // code, say) is refused even though it's in the same org.
  if (s.role === "CARETAKER" && invite.role !== "TENANT") notFound();

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${h.get("host")}`;
  // A tenant invite carries that tenant's own phone/email — masked (and the
  // WhatsApp link, which embeds the number, withheld) for staff below
  // manager/director/admin. Staff invites are not tenant details.
  const hideAddress = Boolean(invite.tenantId) && !canViewTenantDetails(s);
  const shownEmail = invite.email ? (hideAddress ? MASK : invite.email) : null;
  const shownPhone = invite.phone ? (hideAddress ? MASK : invite.phone) : null;
  const wa = hideAddress ? null : waLink(
    invite.phone,
    `Hi, please register your account here: ${origin}/register — your invitation code is ${invite.code}. It expires ${new Date(invite.expiresAt).toLocaleDateString()}.`,
  );

  return (
    <div className="max-w-sm">
      <h1 className="text-lg font-semibold">Invitation created</h1>

      {invite.email && (
        <div
          className={`mt-3 rounded border px-3 py-2 text-sm ${
            emailSent ? "border-green-300 bg-green-50 text-green-700" : "border-orange-300 bg-orange-50 text-orange-800"
          }`}
        >
          {emailSent
            ? `Emailed to ${shownEmail}.`
            : `Could not email ${shownEmail} — check that email sending is configured in Settings, or share the code below directly.`}
        </div>
      )}
      {invite.phone && (
        <div
          className={`mt-2 rounded border px-3 py-2 text-sm ${
            whatsappSent ? "border-green-300 bg-green-50 text-green-700" : "border-orange-300 bg-orange-50 text-orange-800"
          }`}
        >
          {whatsappSent
            ? `Sent to ${shownPhone} on WhatsApp.`
            : `Didn't send automatically to ${shownPhone} — use the "Send on WhatsApp" button below, or share the code directly.`}
        </div>
      )}

      <p className="mt-2 text-sm text-silver-dark">
        Give this code to {shownEmail ?? shownPhone}, along with the address/number it was issued to — they&apos;ll
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
