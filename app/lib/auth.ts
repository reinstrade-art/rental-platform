import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { isPlatformAdmin, isStaff, isTenant, isTradesman } from "./roles";

const COOKIE = "rp_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// The signing secret must be set in production; a dev fallback keeps local
// work friction-free without weakening a deployed instance.
function secretKey(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production")
      throw new Error("AUTH_SECRET must be set in production");
    return new TextEncoder().encode("dev-only-insecure-secret-change-me");
  }
  return new TextEncoder().encode(s);
}

export type Session = {
  userId: string;
  /** Null only for PLATFORM_ADMIN — every other role belongs to exactly one org. */
  organizationId: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  /** Set only on TENANT logins: the single tenancy record this session may read. */
  tenantId: string | null;
  /** Set only on TRADESMAN/CASUAL_LABOURER logins: their own vendor record. */
  vendorId: string | null;
};

/** An address and a phone number are told apart by the "@". */
export function identify(input: string): { email: string } | { phone: string } | null {
  const raw = input.trim();
  if (!raw) return null;
  if (raw.includes("@")) return { email: raw.toLowerCase() };
  return { phone: raw };
}

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

/** Returns the user when the credentials are valid, otherwise null. */
export async function verifyCredentials(identifier: string, password: string) {
  const where = identify(identifier);
  if (!where) return null;
  const user = await prisma.user.findUnique({ where });
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? user : null;
}

export async function createSession(u: {
  id: string;
  organizationId: string | null;
  email: string | null;
  phone: string | null;
  role: string;
}) {
  const token = await new SignJWT({
    organizationId: u.organizationId,
    email: u.email,
    phone: u.phone,
    role: u.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(u.id)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secretKey());

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

// A valid signature only proves the token was issued by us — not that the
// account still exists or that its role/org hasn't changed since. The user
// row is re-read every time so a role change or org suspension takes effect
// immediately instead of waiting for a 30-day-old cookie to expire.
//
// Phase-1 simplification: sessions are stateless JWTs, so "sign out this
// device remotely" / server-side revocation-on-logout is not yet possible —
// deferred, same as it was early in the HM Kariuki reference build.
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    const user = await prisma.user.findUnique({
      where: { id: String(payload.sub) },
      select: { id: true, organizationId: true, email: true, phone: true, role: true, tenantId: true, vendorId: true },
    });
    if (!user) return null;
    // An org's suspension shuts out its staff and tenants immediately —
    // platform admins are exempt, they have no organizationId to suspend.
    if (user.organizationId) {
      const org = await prisma.organization.findUnique({
        where: { id: user.organizationId },
        select: { status: true },
      });
      if (!org || org.status !== "ACTIVE") return null;
    }
    // A tenant/tradesman login with no linked record can read nothing — a
    // role change (or the link being cleared) kills the session outright
    // rather than leaving it pointing at whatever it likes.
    if (isTenant(user.role) && !user.tenantId) return null;
    if (isTradesman(user.role) && !user.vendorId) return null;
    return {
      userId: user.id,
      organizationId: user.organizationId,
      email: user.email,
      phone: user.phone,
      role: user.role,
      tenantId: user.tenantId,
      vendorId: user.vendorId,
    };
  } catch {
    return null;
  }
});

// True when nobody has signed up yet, so the app can offer platform-admin first-run setup.
export async function needsPlatformSetup() {
  return (await prisma.user.count({ where: { role: "PLATFORM_ADMIN" } })) === 0;
}

export { isPlatformAdmin, isStaff, isTenant, isTradesman } from "./roles";

/** Refuses anyone who isn't signed in as staff (ADMIN/MANAGER/VIEWER) of an organization. */
export function requireStaff(s: Session | null): s is Session & { organizationId: string } {
  return Boolean(s) && isStaff(s!.role) && Boolean(s!.organizationId);
}

/** Refuses anyone who isn't signed in as the platform administrator. */
export function requirePlatformAdmin(s: Session | null): s is Session {
  return Boolean(s) && isPlatformAdmin(s!.role);
}

/** Refuses anyone who isn't signed in as a tenant — narrows tenantId to non-null. */
export function requireTenant(s: Session | null): s is Session & { organizationId: string; tenantId: string } {
  return Boolean(s) && isTenant(s!.role) && Boolean(s!.organizationId) && Boolean(s!.tenantId);
}

/** Refuses anyone who isn't signed in as a tradesman/casual labourer — narrows vendorId to non-null. */
export function requireTradesman(s: Session | null): s is Session & { organizationId: string; vendorId: string } {
  return Boolean(s) && isTradesman(s!.role) && Boolean(s!.organizationId) && Boolean(s!.vendorId);
}

// --- document access ---------------------------------------------------
//
// The PDF routes are plain URLs holding a payment or lease id. Checking only
// that someone is signed in would let any tenant read any other tenant's
// receipt by changing the id in the address bar — so ownership is checked
// against the database (including organizationId), never assumed from the
// session's role alone.

/** Staff of the payment's organization, or the tenant whose payment this is. Null means refuse. */
export async function allowPaymentDoc(paymentId: string): Promise<Session | null> {
  const s = await getSession();
  if (!s) return null;
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { organizationId: true, lease: { select: { tenantId: true } } },
  });
  if (!payment) return null;
  if (requireStaff(s) && s.organizationId === payment.organizationId) return s;
  if (requireTenant(s) && s.organizationId === payment.organizationId && s.tenantId === payment.lease.tenantId) return s;
  return null;
}

/** Staff of the lease's organization, or the tenant whose lease this is. Null means refuse. */
export async function allowLeaseDoc(leaseId: string): Promise<Session | null> {
  const s = await getSession();
  if (!s) return null;
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    select: { organizationId: true, tenantId: true },
  });
  if (!lease) return null;
  if (requireStaff(s) && s.organizationId === lease.organizationId) return s;
  if (requireTenant(s) && s.organizationId === lease.organizationId && s.tenantId === lease.tenantId) return s;
  return null;
}
