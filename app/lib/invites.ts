import "server-only";
import crypto from "crypto";
import { headers } from "next/headers";
import { prisma } from "./prisma";
import { hashPassword } from "./auth";
import { CONSENT_VERSION } from "./consent";
import { sendEmail } from "./email";
import { sendWhatsApp } from "./whatsapp";

const INVITE_DAYS = 7;

function generateCode(): string {
  // 8 chars, unambiguous alphabet (no 0/O/1/I), matches the reference build's format.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += alphabet[crypto.randomInt(alphabet.length)];
  return code;
}

/**
 * Issues an invite. For TENANT/TRADESMAN/CASUAL_LABOURER it attaches to an
 * existing Tenant or Vendor record (never creates one); CARETAKER attaches
 * to an existing Property the same way. For MANAGER/VIEWER — a staff invite
 * — target is empty; there is no pre-existing row to attach to. Never ADMIN:
 * the one bootstrap admin per org comes from platform-admin provisioning,
 * not this flow.
 */
export async function createInvitation(
  organizationId: string,
  role: "MANAGER" | "VIEWER" | "CARETAKER" | "TENANT" | "TRADESMAN" | "CASUAL_LABOURER",
  target: { tenantId?: string; vendorId?: string; propertyId?: string },
  identifier: { email?: string; phone?: string },
) {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
  const invite = await prisma.invitation.create({
    data: {
      organizationId,
      role,
      tenantId: target.tenantId ?? null,
      vendorId: target.vendorId ?? null,
      propertyId: target.propertyId ?? null,
      email: identifier.email?.trim().toLowerCase() || null,
      phone: identifier.phone?.trim() || null,
      code,
      expiresAt,
    },
  });

  // Best-effort — a failed send here doesn't fail the invite itself; staff
  // can still read the code off the confirmation page, or use its WhatsApp
  // button by hand. sendEmail/sendWhatsApp are themselves no-ops until their
  // provider env vars are configured, so this comes back false rather than
  // throwing — the caller (and ultimately the confirmation page) decides
  // what to show for that, instead of it being silent.
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${h.get("host")}`;
  const message = `Hi, please register your account here: ${origin}/register — your invitation code is ${code}. It expires ${expiresAt.toLocaleDateString()}.`;
  const [emailSent, whatsappSent] = await Promise.all([
    invite.email ? sendEmail(invite.email, "Your registration invite", message).catch(() => false) : Promise.resolve(false),
    invite.phone ? sendWhatsApp(invite.phone, message).catch(() => false) : Promise.resolve(false),
  ]);

  return { ...invite, emailSent, whatsappSent };
}

/** Builds the confirmation-page URL, carrying the delivery outcome through the redirect so the page can say what actually happened rather than assuming it worked. */
export function inviteRedirectUrl(invite: { id: string; emailSent: boolean; whatsappSent: boolean }): string {
  const params = new URLSearchParams();
  if (invite.emailSent) params.set("emailSent", "1");
  if (invite.whatsappSent) params.set("whatsappSent", "1");
  const qs = params.toString();
  return `/invites/${invite.id}${qs ? `?${qs}` : ""}`;
}

export type RedeemResult =
  | { ok: true; userId: string; role: string }
  | { ok: false; error: string };

/**
 * Redeems a code: creates the User row attached to the invitation's existing
 * Tenant/Vendor record and marks the invite spent. Every failure path
 * ("no such code", "already used", "expired") returns the same shape of
 * error deliberately, so the registration form can't be used to probe which
 * codes exist or have been used.
 */
export async function redeemInvitation(
  code: string,
  identifier: string,
  password: string,
  consented: boolean,
): Promise<RedeemResult> {
  const invite = await prisma.invitation.findUnique({ where: { code: code.trim().toUpperCase() } });
  const generic = { ok: false as const, error: "That invitation code is invalid or has expired." };

  if (!invite || invite.usedAt || invite.expiresAt < new Date()) return generic;

  const typed = identifier.trim();
  const matchesEmail = invite.email && typed.toLowerCase() === invite.email;
  const matchesPhone = invite.phone && typed === invite.phone;
  if (!matchesEmail && !matchesPhone) return generic;

  if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };
  if (!consented) return { ok: false, error: "You must agree to the data notice to register." };

  // User.email/phone are unique across the whole table, not per org — the
  // same address redeeming a second invite (a repeat test, or someone
  // already registered elsewhere) would otherwise crash the transaction
  // below with a raw SQLite constraint error instead of a message.
  const existing = await prisma.user.findFirst({
    where: {
      OR: [invite.email ? { email: invite.email } : undefined, invite.phone ? { phone: invite.phone } : undefined].filter(
        (c): c is { email: string } | { phone: string } => Boolean(c),
      ),
    },
  });
  if (existing) return { ok: false, error: "An account already exists for that email or phone — try signing in instead." };

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        organizationId: invite.organizationId,
        email: invite.email,
        phone: invite.phone,
        passwordHash: await hashPassword(password),
        role: invite.role,
        tenantId: invite.tenantId,
        vendorId: invite.vendorId,
        propertyId: invite.propertyId,
        consentedAt: new Date(),
        consentVersion: CONSENT_VERSION,
      },
    });
    await tx.invitation.update({ where: { id: invite.id }, data: { usedAt: new Date() } });
    return created;
  });

  return { ok: true, userId: user.id, role: user.role };
}
