import "server-only";
import crypto from "crypto";
import { prisma } from "./prisma";
import { hashPassword } from "./auth";

const INVITE_DAYS = 7;

function generateCode(): string {
  // 8 chars, unambiguous alphabet (no 0/O/1/I), matches the reference build's format.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += alphabet[crypto.randomInt(alphabet.length)];
  return code;
}

/** Issues an invite against an existing Tenant or Vendor record — never creates one. */
export async function createInvitation(
  organizationId: string,
  role: "TENANT" | "TRADESMAN" | "CASUAL_LABOURER",
  target: { tenantId?: string; vendorId?: string },
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
): Promise<RedeemResult> {
  const invite = await prisma.invitation.findUnique({ where: { code: code.trim().toUpperCase() } });
  const generic = { ok: false as const, error: "That invitation code is invalid or has expired." };

  if (!invite || invite.usedAt || invite.expiresAt < new Date()) return generic;

  const typed = identifier.trim();
  const matchesEmail = invite.email && typed.toLowerCase() === invite.email;
  const matchesPhone = invite.phone && typed === invite.phone;
  if (!matchesEmail && !matchesPhone) return generic;

  if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };

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
      },
    });
    await tx.invitation.update({ where: { id: invite.id }, data: { usedAt: new Date() } });
    return created;
  });

  return { ok: true, userId: user.id, role: user.role };
}
