import "server-only";
import crypto from "crypto";

/**
 * A per-org, unforgeable path segment for the C2B webhook — Safaricom does
 * not sign C2B callbacks at all, so without this anyone who found (or
 * guessed) an org's webhook URL could POST a fabricated "payment received"
 * and create real rent payments out of nothing. Derived from AUTH_SECRET
 * rather than stored, so there's no new column and no way for it to drift
 * out of sync with what's registered at Safaricom — regenerating it (by
 * rotating AUTH_SECRET) is the same "invalidate every webhook URL at once"
 * escape hatch signing out every session already gives you.
 */
export function mpesaWebhookKey(organizationId: string): string {
  const secret = process.env.AUTH_SECRET ?? "dev-only-insecure-secret-change-me";
  return crypto.createHmac("sha256", secret).update(organizationId).digest("hex").slice(0, 32);
}
