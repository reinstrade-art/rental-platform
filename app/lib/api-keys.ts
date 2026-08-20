import "server-only";
import crypto from "crypto";
import { prisma } from "./prisma";

const PREFIX = "rpk_"; // "rental platform key" — lets a leaked key be recognised on sight in a log or diff.

function hash(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Generates a new key, returning the raw secret (shown to the caller exactly once) alongside what gets stored. */
export function generateApiKey(): { raw: string; keyHash: string; keyPrefix: string } {
  const raw = PREFIX + crypto.randomBytes(24).toString("base64url");
  return { raw, keyHash: hash(raw), keyPrefix: raw.slice(0, 12) };
}

export async function createApiKey(organizationId: string, name: string, createdBy: string) {
  const { raw, keyHash, keyPrefix } = generateApiKey();
  const key = await prisma.apiKey.create({
    data: { organizationId, name, keyHash, keyPrefix, createdBy },
  });
  return { key, raw };
}

export async function listApiKeys(organizationId: string) {
  return prisma.apiKey.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
}

export async function revokeApiKey(organizationId: string, keyId: string) {
  await prisma.apiKey.updateMany({
    where: { id: keyId, organizationId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Resolves an `Authorization: Bearer <key>` header to the organization it
 * belongs to — every app/api/v1 route's sole gate, since these requests
 * carry no session cookie. Touches lastUsedAt best-effort on every call, so
 * a landlord can tell a key is actually wired into something without that
 * write ever blocking or failing the request it's attached to.
 */
export async function authenticateApiKey(req: Request): Promise<{ organizationId: string; keyId: string } | null> {
  const header = req.headers.get("authorization") ?? "";
  const raw = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!raw) return null;

  const key = await prisma.apiKey.findUnique({ where: { keyHash: hash(raw) } });
  if (!key || key.revokedAt) return null;

  prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return { organizationId: key.organizationId, keyId: key.id };
}
