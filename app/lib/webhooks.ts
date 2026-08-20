import "server-only";
import crypto from "crypto";
import { prisma } from "./prisma";

export async function createWebhook(organizationId: string, url: string, createdBy: string) {
  const secret = crypto.randomBytes(24).toString("base64url");
  return prisma.webhook.create({ data: { organizationId, url, secret, createdBy } });
}

export async function listWebhooks(organizationId: string) {
  return prisma.webhook.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
}

export async function revokeWebhook(organizationId: string, webhookId: string) {
  await prisma.webhook.updateMany({
    where: { id: webhookId, organizationId, disabledAt: null },
    data: { disabledAt: new Date() },
  });
}

/**
 * Fires `event` at every active webhook on the org — awaited directly by
 * the caller (no queue, no retry) so it only ever runs from a path that can
 * afford a second or two of extra latency, never from a request a person is
 * staring at expecting an instant response. lastTriggeredAt/lastStatus are
 * updated regardless of outcome, so a broken endpoint is visible in
 * Settings rather than silently swallowed forever.
 */
export async function dispatchWebhookEvent(
  organizationId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const hooks = await prisma.webhook.findMany({ where: { organizationId, disabledAt: null } });
  if (hooks.length === 0) return;

  const body = JSON.stringify({ event, data: payload, sentAt: new Date().toISOString() });

  await Promise.all(
    hooks.map(async (hook) => {
      const signature = crypto.createHmac("sha256", hook.secret).update(body).digest("hex");
      let status: number | null = null;
      try {
        const res = await fetch(hook.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Webhook-Signature": signature, "X-Webhook-Event": event },
          body,
          signal: AbortSignal.timeout(8_000),
        });
        status = res.status;
      } catch {
        status = null;
      }
      await prisma.webhook
        .update({ where: { id: hook.id }, data: { lastTriggeredAt: new Date(), lastStatus: status } })
        .catch(() => {});
    }),
  );
}
