import "server-only";
import { prisma } from "./prisma";

/**
 * Lazily initialized so a deploy without FIREBASE_SERVICE_ACCOUNT set (every
 * environment until the org actually configures push) never crashes on
 * import — every call below just no-ops instead, the same shape as
 * mpesaConfigured() elsewhere in this file's siblings.
 */
let messaging: import("firebase-admin/messaging").Messaging | null | undefined;

async function getMessaging() {
  if (messaging !== undefined) return messaging;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    messaging = null;
    return messaging;
  }

  const { initializeApp, cert, getApps } = await import("firebase-admin/app");
  const { getMessaging: getMessagingSdk } = await import("firebase-admin/messaging");
  const serviceAccount = JSON.parse(raw);
  const app = getApps()[0] ?? initializeApp({ credential: cert(serviceAccount) });
  messaging = getMessagingSdk(app);
  return messaging;
}

/** Called once by the app on launch (see /api/push/register) — reassigns the token if some other user already held it (a phone changing hands, or a reinstall). */
export async function registerDeviceToken(userId: string, token: string) {
  await prisma.deviceToken.upsert({
    where: { token },
    create: { userId, token },
    update: { userId, lastSeenAt: new Date() },
  });
}

/**
 * Best-effort: a bad or expired token is dropped so it stops being retried,
 * but nothing here throws back into the caller — a push failing is never
 * reason to fail the charge/payment/approval action that triggered it.
 */
export async function sendPushToUser(userId: string, notification: { title: string; body: string; data?: Record<string, string> }) {
  const fcm = await getMessaging();
  if (!fcm) return;

  const tokens = await prisma.deviceToken.findMany({ where: { userId }, select: { id: true, token: true } });
  if (tokens.length === 0) return;

  const results = await fcm.sendEachForMulticast({
    tokens: tokens.map((t) => t.token),
    notification: { title: notification.title, body: notification.body },
    data: notification.data,
  });

  const dead = results.responses
    .map((r, i) => (!r.success && (r.error?.code === "messaging/registration-token-not-registered" || r.error?.code === "messaging/invalid-registration-token") ? tokens[i].id : null))
    .filter((id): id is string => id !== null);
  if (dead.length > 0) {
    await prisma.deviceToken.deleteMany({ where: { id: { in: dead } } });
  }
}

export async function sendPushToUsers(userIds: string[], notification: { title: string; body: string; data?: Record<string, string> }) {
  await Promise.all([...new Set(userIds)].map((id) => sendPushToUser(id, notification)));
}

/** A charge or payment names a lease, never a user directly — resolves to the tenant's own portal account, if they've registered for one, and no-ops otherwise. */
export async function notifyTenantForLease(leaseId: string, notification: { title: string; body: string; data?: Record<string, string> }) {
  const lease = await prisma.lease.findUnique({ where: { id: leaseId }, select: { tenant: { select: { user: { select: { id: true } } } } } });
  const userId = lease?.tenant.user?.id;
  if (userId) await sendPushToUser(userId, notification);
}
