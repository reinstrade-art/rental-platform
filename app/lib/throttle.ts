import { prisma } from "./prisma";

// Five wrong passwords locks the address for fifteen minutes. Keyed on the
// identifier typed at sign-in rather than the IP, so a lock can't be dodged
// by switching networks, and recorded even for unknown addresses, so a
// lock's presence never reveals which accounts exist.
export const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const WINDOW_MINUTES = 60;

export type LockState = { locked: false } | { locked: true; minutesLeft: number };

function key(identifier: string) {
  return identifier.trim().toLowerCase();
}

export async function checkLock(identifier: string): Promise<LockState> {
  const row = await prisma.loginAttempt.findUnique({ where: { email: key(identifier) } });
  if (!row?.lockedUntil) return { locked: false };
  const msLeft = row.lockedUntil.getTime() - Date.now();
  if (msLeft <= 0) return { locked: false };
  return { locked: true, minutesLeft: Math.max(1, Math.ceil(msLeft / 60_000)) };
}

export async function recordFailure(identifier: string): Promise<LockState & { remaining?: number }> {
  const k = key(identifier);
  const now = new Date();
  const row = await prisma.loginAttempt.findUnique({ where: { email: k } });

  const stale = row && now.getTime() - row.lastFailed.getTime() > WINDOW_MINUTES * 60_000;
  const count = (stale || !row ? 0 : row.failedCount) + 1;

  if (count >= MAX_ATTEMPTS) {
    const lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60_000);
    await prisma.loginAttempt.upsert({
      where: { email: k },
      create: { email: k, failedCount: count, lastFailed: now, lockedUntil },
      update: { failedCount: count, lastFailed: now, lockedUntil },
    });
    return { locked: true, minutesLeft: LOCK_MINUTES };
  }

  await prisma.loginAttempt.upsert({
    where: { email: k },
    create: { email: k, failedCount: count, lastFailed: now, lockedUntil: null },
    update: { failedCount: count, lastFailed: now, lockedUntil: null },
  });
  return { locked: false, remaining: MAX_ATTEMPTS - count };
}

export async function clearFailures(identifier: string) {
  await prisma.loginAttempt.delete({ where: { email: key(identifier) } }).catch(() => {});
}
