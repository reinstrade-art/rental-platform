import "server-only";
import { mpesaNumber } from "./phone";

/**
 * Safaricom's Lipa Na M-Pesa Online (STK Push) — the prompt that lands on a
 * phone asking for the M-Pesa PIN. This is the only "M-Pesa integration"
 * that moves money on its own initiative; everything else (a paybill number
 * printed on an invoice) needs a human to key it in by hand.
 *
 * Unlike C2B auto-capture against a shared paybill, STK Push sidesteps the
 * "whose account number is this" problem entirely: the app raises the
 * prompt itself, Safaricom hands back a checkoutRequestId the app itself
 * generated, and the callback is matched against that id — never a
 * human-typed reference. The real constraint that doesn't go away: this
 * still needs the ORGANIZATION'S OWN Safaricom shortcode. There is no
 * platform-wide credential; each org configures its own in Settings.
 */

export type DarajaCredentials = {
  env: string | null; // "sandbox" | "production" — sandbox unless explicitly production
  shortcode: string | null;
  // "PAYBILL" | "TILL" | null — null reads as PAYBILL. Changes only which
  // STK Push TransactionType is sent; a Till number (Buy Goods and Services)
  // uses the exact same shortcode/password/PartyB shape as a paybill, just a
  // different TransactionType value.
  accountType: string | null;
  consumerKey: string | null;
  consumerSecret: string | null;
  passkey: string | null;
};

function host(env: string | null): string {
  return env === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
}

export function mpesaConfigured(c: DarajaCredentials): boolean {
  return Boolean(c.shortcode && c.consumerKey && c.consumerSecret && c.passkey);
}

/** yyyyMMddHHmmss, the form Safaricom expects. */
function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function accessToken(c: DarajaCredentials): Promise<string> {
  const auth = Buffer.from(`${c.consumerKey}:${c.consumerSecret}`).toString("base64");
  const res = await fetch(`${host(c.env)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Could not authenticate with Safaricom (${res.status}).`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export type StkPushResult =
  | { ok: true; merchantRequestId: string; checkoutRequestId: string }
  | { ok: false; reason: string };

/** Raises the prompt. `phone` is normalised through mpesaNumber before use. */
export async function stkPush(
  credentials: DarajaCredentials,
  opts: { phone: string; amount: number; accountReference: string; description: string; callbackUrl: string },
): Promise<StkPushResult> {
  if (!mpesaConfigured(credentials)) {
    return { ok: false, reason: "M-Pesa is not configured for this organization — set it up in Settings." };
  }

  const phone = mpesaNumber(opts.phone);
  if (!phone) return { ok: false, reason: "No usable phone number on file." };

  const amount = Math.round(opts.amount);
  if (amount < 1) return { ok: false, reason: "Enter an amount to send the prompt for." };

  const shortcode = credentials.shortcode!;
  const ts = timestamp();
  const password = Buffer.from(`${shortcode}${credentials.passkey}${ts}`).toString("base64");
  const transactionType = credentials.accountType === "TILL" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline";

  try {
    const token = await accessToken(credentials);
    const res = await fetch(`${host(credentials.env)}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: ts,
        TransactionType: transactionType,
        Amount: amount,
        PartyA: phone,
        PartyB: shortcode,
        PhoneNumber: phone,
        CallBackURL: opts.callbackUrl,
        AccountReference: opts.accountReference.slice(0, 12),
        TransactionDesc: opts.description.slice(0, 13),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const data = (await res.json().catch(() => ({}))) as {
      MerchantRequestID?: string;
      CheckoutRequestID?: string;
      ResponseCode?: string;
      errorMessage?: string;
      ResponseDescription?: string;
    };

    if (!res.ok || data.ResponseCode !== "0" || !data.CheckoutRequestID) {
      return { ok: false, reason: data.errorMessage ?? data.ResponseDescription ?? `${res.status}: the request was refused` };
    }
    return { ok: true, merchantRequestId: data.MerchantRequestID!, checkoutRequestId: data.CheckoutRequestID };
  } catch (e) {
    const err = e as Error;
    return { ok: false, reason: err.name === "TimeoutError" ? "Safaricom timed out." : err.message };
  }
}

/** The shape Safaricom posts back to CallBackURL. */
export type StkCallback = {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: { Item: { Name: string; Value?: string | number }[] };
    };
  };
};

/** Pulls the handful of fields worth keeping out of the metadata array. */
export function parseCallbackMetadata(cb: StkCallback) {
  const items = cb.Body.stkCallback.CallbackMetadata?.Item ?? [];
  const get = (name: string) => items.find((i) => i.Name === name)?.Value;
  return {
    amount: get("Amount") as number | undefined,
    mpesaReceiptNumber: get("MpesaReceiptNumber") as string | undefined,
  };
}
