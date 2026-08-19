import "server-only";
import { mpesaNumber } from "./phone";

/**
 * Meta's WhatsApp Cloud API — an actual push, unlike waLink() in phone.ts
 * which only builds a wa.me link someone has to click. This needs a
 * verified WhatsApp Business number and, outside an existing 24h customer
 * conversation, an approved message template; until WHATSAPP_TOKEN and
 * WHATSAPP_PHONE_NUMBER_ID are set (Meta business verification can take a
 * few days), this is a no-op and every caller falls back to the manual
 * waLink() button already on the invite confirmation page.
 */
export async function sendWhatsApp(phone: string | null | undefined, message: string): Promise<boolean> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return false;

  const to = mpesaNumber(phone);
  if (!to) return false;

  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: message } }),
    });
    if (!res.ok) {
      console.error("sendWhatsApp failed", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e) {
    console.error("sendWhatsApp error", e);
    return false;
  }
}
