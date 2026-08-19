import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { isPlatformAdmin, isStaff, isCaretaker, isTenant, isTradesman } from "./roles";
import { isLicenseActive } from "./licensing";

const COOKIE = "rp_session";
// Holds the staff member's own token while they are signed in as somebody
// else, so "return to my account" hands back the session that was actually
// theirs rather than just logging everyone out.
const IMPERSONATOR_COOKIE = "rp_impersonator";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// A session's "last seen" is only worth writing this often — a stamp accurate
// to the last few minutes tells a person which device is theirs just as well
// as one accurate to the second, at a fraction of the writes.
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** A short, recognisable label for the device behind a session — never exact, just enough to tell devices apart at a glance. */
export function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Firefox\//.test(userAgent)
          ? "Firefox"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "Browser";
  const os = /Windows/.test(userAgent)
    ? "Windows"
    : /Android/.test(userAgent)
      ? "Android"
      : /iPhone|iPad|iPod/.test(userAgent)
        ? "iOS"
        : /Mac OS/.test(userAgent)
          ? "Mac"
          : /Linux/.test(userAgent)
            ? "Linux"
            : null;
  return os ? `${browser} on ${os}` : browser;
}

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
  /** Set only on CARETAKER logins: the single property they onboard tenants for. */
  propertyId: string | null;
  /** Set when a staff member is signed in as this account rather than the account itself. */
  impersonatedBy: { id: string; email: string | null } | null;
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
  // Explicit select (rather than the model default of every column) so this
  // keeps working the moment a new nullable column is added to User in code
  // but a production deploy briefly lands before its migration is applied —
  // see getSession()'s matching fallback below for the same reasoning.
  const user = await prisma.user.findUnique({
    where,
    select: {
      id: true,
      organizationId: true,
      email: true,
      phone: true,
      role: true,
      passwordHash: true,
      disabledAt: true,
    },
  });
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? user : null;
}

/** Re-checks a password for an account already signed in. */
export async function verifyPassword(userId: string, password: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  return user ? bcrypt.compare(password, user.passwordHash) : false;
}

export async function createSession(
  u: { id: string; organizationId: string | null; email: string | null; phone: string | null; role: string },
  /** Set only when a staff member is opening this session on somebody else's behalf. */
  impersonatedByUserId?: string,
) {
  const h = await headers();
  const userAgent = h.get("user-agent");
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const expiresAt = new Date(Date.now() + MAX_AGE * 1000);

  // The row exists before the token does — its id IS the token's jti, so a
  // token can never be minted for a session that isn't there to revoke.
  const record = await prisma.session.create({
    data: { userId: u.id, userAgent, ip, expiresAt, impersonatedByUserId },
  });

  const token = await new SignJWT({
    organizationId: u.organizationId,
    email: u.email,
    phone: u.phone,
    role: u.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(u.id)
    .setJti(record.id)
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

/**
 * A staff member opening a session as somebody else in their OWN
 * organization — for tracking down a problem that only shows up from their
 * side, without needing their password.
 *
 * Never across organizations (the target must belong to the acting admin's
 * own org) and never onto another ADMIN (two admins are peers, and one
 * silently acting as the other is exactly the access this feature must not
 * grant). The admin's own token is stashed in a second cookie first, so
 * returning hands back the session that was actually theirs.
 */
export async function impersonate(admin: Session, targetUserId: string) {
  if (!requireStaff(admin)) throw new Error("Not authorized.");

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, organizationId: true, email: true, phone: true, role: true, disabledAt: true },
  });
  if (!target || target.disabledAt) throw new Error("That account cannot be signed in to.");
  if (target.organizationId !== admin.organizationId) throw new Error("That account is not in your organization.");
  // Two admins are peers — one silently acting as the other is exactly the
  // access this feature must not grant.
  if (target.role === "ADMIN") throw new Error("Cannot sign in as another administrator.");

  const ownToken = (await cookies()).get(COOKIE)?.value;
  if (ownToken) {
    (await cookies()).set(IMPERSONATOR_COOKIE, ownToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: MAX_AGE,
    });
  }

  await createSession(
    { id: target.id, organizationId: target.organizationId, email: target.email, phone: target.phone, role: target.role },
    admin.userId,
  );
}

/**
 * Handing the session back. The borrowed one is revoked outright rather than
 * merely left behind — nobody else should be able to pick it up and carry on
 * as that person once the office has stepped away from it.
 */
export async function endImpersonation() {
  const returnToken = (await cookies()).get(IMPERSONATOR_COOKIE)?.value;
  await destroySession();
  (await cookies()).delete(IMPERSONATOR_COOKIE);
  if (returnToken) {
    (await cookies()).set(COOKIE, returnToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: MAX_AGE,
    });
  }
}

/** The current cookie's session id, or null — read without trusting anything but the signature. */
async function currentSessionId(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return typeof payload.jti === "string" ? payload.jti : null;
  } catch {
    return null;
  }
}

/**
 * Signing out revokes the row, not just the cookie. Clearing the cookie alone
 * leaves the token itself still good — anyone holding a copy of it (a synced
 * browser profile, a shared computer, a leaked log) could keep using it until
 * it expired on its own, weeks later.
 */
export async function destroySession() {
  const sessionId = await currentSessionId();
  (await cookies()).delete(COOKIE);
  if (sessionId) {
    await prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}

/** Every other device this account is signed in on — the id currently in the browser is excluded, not just recognised. */
export async function otherSessions(userId: string) {
  const excludeId = await currentSessionId();
  return prisma.session.findMany({
    where: {
      userId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    orderBy: { lastSeenAt: "desc" },
  });
}

/** Signs out one of the account's OWN other sessions. Never the caller's own current one — that is what "sign out" is for. */
export async function revokeSession(userId: string, sessionId: string) {
  const excludeId = await currentSessionId();
  if (sessionId === excludeId) return;
  await prisma.session.updateMany({ where: { id: sessionId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

/**
 * Every device but this one. Offered next to "change my password" as much as
 * on its own — a new password does nothing for a device that was already
 * signed in before it changed.
 */
export async function revokeOtherSessions(userId: string) {
  const excludeId = await currentSessionId();
  await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

/** Every session on the account — for staff signing another account out entirely (e.g. disabling access). */
export async function revokeAllSessions(userId: string) {
  await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

// A valid signature only proves the token was issued by us — not that the
// account still exists, that this session hasn't been signed out elsewhere,
// or that its role/org hasn't changed since. The user row and Session record
// are read every time so a role change, account disable, org suspension, or
// remote sign-out all take effect immediately instead of waiting for a
// 30-day-old cookie to expire.
//
// Wrapped in cache() so the layout and any server actions in the same request
// share a single query rather than repeating it.
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());

    // Sessions minted before this table existed carry no jti — left to
    // expire on their own schedule rather than logging out everyone signed
    // in the moment this shipped, but every session from here on is checked.
    const sessionId = typeof payload.jti === "string" ? payload.jti : null;
    let impersonatedBy: { id: string; email: string | null } | null = null;
    if (sessionId) {
      const record = await prisma.session.findUnique({
        where: { id: sessionId },
        select: { revokedAt: true, expiresAt: true, lastSeenAt: true, impersonatedByUserId: true },
      });
      if (!record || record.revokedAt || record.expiresAt < new Date()) return null;
      if (Date.now() - record.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
        // Best-effort — a missed touch just means the "last active" shown
        // later is a few minutes stale, not that the session stops working.
        await prisma.session.update({ where: { id: sessionId }, data: { lastSeenAt: new Date() } }).catch(() => {});
      }
      if (record.impersonatedByUserId) {
        const admin = await prisma.user.findUnique({
          where: { id: record.impersonatedByUserId },
          select: { id: true, email: true },
        });
        if (admin) impersonatedBy = admin;
      }
    }

    // propertyId is read with its own fallback query: a deploy adding it as a
    // Prisma-schema column lands before the matching production ALTER TABLE
    // is run (see app/api/internal/migrate-caretaker-role), and until that
    // runs, selecting a column the live table doesn't have yet would fail
    // this query for every signed-in user, not just caretakers.
    const baseSelect = { id: true, organizationId: true, email: true, phone: true, role: true, tenantId: true, vendorId: true, disabledAt: true } as const;
    let user: {
      id: string;
      organizationId: string | null;
      email: string | null;
      phone: string | null;
      role: string;
      tenantId: string | null;
      vendorId: string | null;
      disabledAt: Date | null;
      propertyId: string | null;
    } | null;
    try {
      const withProperty = await prisma.user.findUnique({
        where: { id: String(payload.sub) },
        select: { ...baseSelect, propertyId: true },
      });
      user = withProperty;
    } catch {
      const fallback = await prisma.user.findUnique({ where: { id: String(payload.sub) }, select: baseSelect });
      user = fallback ? { ...fallback, propertyId: null } : null;
    }
    // No account, or access individually revoked — either way the session is dead.
    if (!user || user.disabledAt) return null;
    // An org's suspension shuts out its staff and tenants immediately —
    // platform admins are exempt, they have no organizationId to suspend.
    if (user.organizationId) {
      const org = await prisma.organization.findUnique({
        where: { id: user.organizationId },
        select: { status: true, trialEndsAt: true, licenseExpiresAt: true },
      });
      // Two independent gates: a platform admin's manual suspension, and the
      // billing lifecycle (trial or paid license). Either being unfavorable
      // shuts out every login in the organization, staff and tenants alike —
      // see app/lib/licensing.ts for why this isn't split further.
      if (!org || org.status !== "ACTIVE" || !isLicenseActive(org)) return null;
    }
    // A tenant/tradesman login with no linked record can read nothing — a
    // role change (or the link being cleared) kills the session outright
    // rather than leaving it pointing at whatever it likes.
    if (isTenant(user.role) && !user.tenantId) return null;
    if (isTradesman(user.role) && !user.vendorId) return null;
    if (isCaretaker(user.role) && !user.propertyId) return null;
    return {
      userId: user.id,
      organizationId: user.organizationId,
      email: user.email,
      phone: user.phone,
      role: user.role,
      tenantId: user.tenantId,
      vendorId: user.vendorId,
      propertyId: user.propertyId,
      impersonatedBy,
    };
  } catch {
    return null;
  }
});

// True when nobody has signed up yet, so the app can offer platform-admin first-run setup.
export async function needsPlatformSetup() {
  return (await prisma.user.count({ where: { role: "PLATFORM_ADMIN" } })) === 0;
}

export { isPlatformAdmin, isStaff, isCaretaker, isTenant, isTradesman } from "./roles";

/** Refuses anyone who isn't signed in as staff (ADMIN/MANAGER/VIEWER) of an organization. */
export function requireStaff(s: Session | null): s is Session & { organizationId: string } {
  return Boolean(s) && isStaff(s!.role) && Boolean(s!.organizationId);
}

/** Refuses anyone who isn't a property caretaker — narrows propertyId to non-null. */
export function requireCaretaker(s: Session | null): s is Session & { organizationId: string; propertyId: string } {
  return Boolean(s) && isCaretaker(s!.role) && Boolean(s!.organizationId) && Boolean(s!.propertyId);
}

/**
 * The Tenants module's own gate — the one place in the app a caretaker is
 * let in, alongside full staff. Every other page keeps using requireStaff
 * alone, so a caretaker is refused everywhere by default; this is the single
 * explicit opt-in, not a broadening of requireStaff itself.
 */
export function requireTenantsAccess(s: Session | null): s is Session & { organizationId: string } {
  return requireStaff(s) || requireCaretaker(s);
}

/** Refuses anyone who isn't signed in as an organization ADMIN — for actions only the org owner may take (inviting/disabling staff, impersonation). */
export function requireOrgAdmin(s: Session | null): s is Session & { organizationId: string } {
  return Boolean(s) && s!.role === "ADMIN" && Boolean(s!.organizationId);
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

/**
 * The platform admin own version of impersonate() above - crosses
 * organizations by design (that is the entire point: full support access to
 * a customer data through their own real UI, rather than a second,
 * parallel set of platform-side CRUD forms that would drift from the staff
 * app over time), and - unlike the peer-to-peer staff version - MAY reach
 * the org own ADMIN seat, since anything less would not actually be full
 * access. Every call is a deliberate, logged cross-org action (see
 * platformImpersonateAction), on the same footing as viewing an org data.
 */
export async function platformImpersonate(admin: Session, targetUserId: string) {
  if (!requirePlatformAdmin(admin)) throw new Error("Not authorized.");

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, organizationId: true, email: true, phone: true, role: true, disabledAt: true },
  });
  if (!target || target.disabledAt) throw new Error("That account cannot be signed in to.");
  if (!target.organizationId || !isStaff(target.role)) throw new Error("Only an organization own staff can be signed in to.");

  const ownToken = (await cookies()).get(COOKIE)?.value;
  if (ownToken) {
    (await cookies()).set(IMPERSONATOR_COOKIE, ownToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: MAX_AGE,
    });
  }

  await createSession(
    { id: target.id, organizationId: target.organizationId, email: target.email, phone: target.phone, role: target.role },
    admin.userId,
  );
  return target.organizationId;
}
