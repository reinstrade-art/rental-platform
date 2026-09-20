import "server-only";
import { mpesaNumber } from "./phone";

/**
 * Plain SMS through Africa's Talking — the channel Kenyan tenants actually
 * read, and the one that works on every phone with no app, no data and no
 * WhatsApp business verification. Same shape as sendWhatsApp(): until
 * AT_USERNAME and AT_API_KEY are set this is a no-op that returns false, so
 * every caller already treats "SMS didn't go" as a normal outcome and falls
 * through to its other channels (push, email, WhatsApp).
 *
 *   AT_USERNAME   your Africa's Talking username ("sandbox" for testing)
 *   AT_API_KEY    the API key from that account
 *   AT_SENDER_ID  optional — a registered alphanumeric sender ID (there is a
 *                 one-off registration fee); without it messages go from a
 *                 shared shortcode.
 *
 * A message over 160 characters is billed as several, so callers keep
 * reminders short.
 */
export async function sendSms(phone: string | null | undefined, message: string): Promise<boolean> {
  const username = process.env.AT_USERNAME;
  const apiKey = process.env.AT_API_KEY;
  if (!username || !apiKey) return false;

  const number = mpesaNumber(phone); // 2547XXXXXXXX
  if (!number) return false;

  const host = username === "sandbox" ? "api.sandbox.africastalking.com" : "api.africastalking.com";
  const form = new URLSearchParams({ username, to: `+${number}`, message });
  if (process.env.AT_SENDER_ID) form.set("from", process.env.AT_SENDER_ID);

  try {
    const res = await fetch(`https://${host}/version1/messaging`, {
      method: "POST",
      headers: { apiKey, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error("sendSms failed", res.status, await res.text().catch(() => ""));
      return false;
    }
    const data = (await res.json().catch(() => null)) as {
      SMSMessageData?: { Recipients?: { statusCode?: number }[] };
    } | null;
    // 100 Processed, 101 Sent, 102 Queued — anything else is a rejection.
    return Boolean(data?.SMSMessageData?.Recipients?.some((r) => r.statusCode !== undefined && r.statusCode >= 100 && r.statusCode <= 102));
  } catch (e) {
    console.error("sendSms error", e);
    return false;
  }
}
