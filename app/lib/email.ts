import "server-only";

/**
 * Thin Resend wrapper. Both env vars are optional — when either is unset,
 * sendEmail() is a no-op that resolves false, so every call site (invites,
 * tier-request confirmations) degrades to "nothing sent" rather than
 * throwing when this hasn't been configured yet.
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!key || !from) return false;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text }),
    });
    if (!res.ok) {
      console.error("sendEmail failed", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e) {
    console.error("sendEmail error", e);
    return false;
  }
}
