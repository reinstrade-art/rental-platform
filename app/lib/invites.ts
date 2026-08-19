import "server-only";
import crypto from "crypto";
import { prisma } from "./prisma";
import { hashPassword } from "./auth";
import { CONSENT_VERSION } from "./consent";

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
  return prisma.invitation.create({
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
