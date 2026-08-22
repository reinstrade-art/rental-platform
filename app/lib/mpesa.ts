import "server-only";
import crypto from "crypto";
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

export type C2bRegisterResult = { ok: true } | { ok: false; reason: string };

/**
 * One-time call telling Safaricom where to POST C2B payments for this
 * shortcode. ResponseType "Completed" means Safaricom treats every
 * transaction as pre-validated and calls ConfirmationURL only — there's no
 * separate accept/reject decision this app needs to make, so the same URL
 * is registered for both. Re-running this simply overwrites the previous
 * registration, which is exactly what's wanted if the webhook's signed key
 * ever changes (see webhook-secret.ts).
 */
export async function registerC2bUrls(credentials: DarajaCredentials, confirmationUrl: string): Promise<C2bRegisterResult> {
  if (!mpesaConfigured(credentials)) {
    return { ok: false, reason: "Configure M-Pesa STK credentials for this organization first." };
  }

  try {
    const token = await accessToken(credentials);
    const res = await fetch(`${host(credentials.env)}/mpesa/c2b/v2/registerurl`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        ShortCode: credentials.shortcode,
        ResponseType: "Completed",
        ConfirmationURL: confirmationUrl,
        ValidationURL: confirmationUrl,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { ResponseCode?: string; errorMessage?: string; ResponseDescription?: string };
    if (!res.ok || (data.ResponseCode !== undefined && data.ResponseCode !== "0")) {
      return { ok: false, reason: data.errorMessage ?? data.ResponseDescription ?? `${res.status}: the request was refused` };
    }
    return { ok: true };
  } catch (e) {
    const err = e as Error;
    return { ok: false, reason: err.name === "TimeoutError" ? "Safaricom timed out." : err.message };
  }
}

/** Pulls the handful of fields worth keeping out of the metadata array. */
export function parseCallbackMetadata(cb: StkCallback) {
  const items = cb.Body.stkCallback.CallbackMetadata?.Item ?? [];
  const get = (name: string) => items.find((i) => i.Name === name)?.Value;
  return {
    amount: get("Amount") as number | undefined,
    mpesaReceiptNumber: get("MpesaReceiptNumber") as string | undefined,
  };
}

// --- B2C disbursement — forwarding a landlord's share of a commission-
// routed rent payment out of the platform's own paybill. A different Daraja
// product from STK Push above: it needs an "initiator" identity (a Daraja
// API operator on the shortcode) and a SecurityCredential, which Safaricom
// defines as the initiator's password RSA-encrypted against a certificate
// Safaricom issues per environment — never the plain password on the wire.

export type B2cCredentials = DarajaCredentials & {
  initiatorName: string | null;
  initiatorPassword: string | null;
  /** Safaricom's public certificate (PEM), used to encrypt initiatorPassword per-request — never stored encrypted, so a cert rotation needs no re-encryption step. */
  certPem: string | null;
};

export function b2cConfigured(c: B2cCredentials): boolean {
  return mpesaConfigured(c) && Boolean(c.initiatorName && c.initiatorPassword && c.certPem);
}

function securityCredential(initiatorPassword: string, certPem: string): string {
  const encrypted = crypto.publicEncrypt(
    { key: certPem, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(initiatorPassword, "utf8"),
  );
  return encrypted.toString("base64");
}

export type B2cResult =
  | { ok: true; conversationId: string; originatorConversationId: string }
  | { ok: false; reason: string };

/**
 * Sends `amount` from the platform's own shortcode to `phone`. CommandID
 * "BusinessPayment" is the general-purpose one Safaricom expects for a
 * business paying an individual outside payroll/promotions — this is a
 * landlord's rent share, not either of those.
 */
export async function b2cPayout(
  credentials: B2cCredentials,
  opts: { phone: string; amount: number; remarks: string; resultUrl: string; timeoutUrl: string },
): Promise<B2cResult> {
  if (!b2cConfigured(credentials)) {
    return { ok: false, reason: "B2C payouts are not configured for the platform yet." };
  }

  const phone = mpesaNumber(opts.phone);
  if (!phone) return { ok: false, reason: "No usable payout phone number on file." };

  const amount = Math.round(opts.amount);
  if (amount < 1) return { ok: false, reason: "Nothing to pay out." };

  const originatorConversationId = crypto.randomUUID();

  try {
    const token = await accessToken(credentials);
    const res = await fetch(`${host(credentials.env)}/mpesa/b2c/v3/paymentrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        OriginatorConversationID: originatorConversationId,
        InitiatorName: credentials.initiatorName,
        SecurityCredential: securityCredential(credentials.initiatorPassword!, credentials.certPem!),
        CommandID: "BusinessPayment",
        Amount: amount,
        PartyA: credentials.shortcode,
        PartyB: phone,
        Remarks: opts.remarks.slice(0, 100),
        QueueTimeOutURL: opts.timeoutUrl,
        ResultURL: opts.resultUrl,
        Occasion: "Rent payout",
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const data = (await res.json().catch(() => ({}))) as {
      ConversationID?: string;
      OriginatorConversationID?: string;
      ResponseCode?: string;
      errorMessage?: string;
      ResponseDescription?: string;
    };

    if (!res.ok || data.ResponseCode !== "0" || !data.ConversationID) {
      return { ok: false, reason: data.errorMessage ?? data.ResponseDescription ?? `${res.status}: the request was refused` };
    }
    return { ok: true, conversationId: data.ConversationID, originatorConversationId };
  } catch (e) {
    const err = e as Error;
    return { ok: false, reason: err.name === "TimeoutError" ? "Safaricom timed out." : err.message };
  }
}

/** The shape Safaricom posts back to a B2C ResultURL. */
export type B2cCallback = {
  Result: {
    ResultType: number;
    ResultCode: number;
    ResultDesc: string;
    OriginatorConversationID: string;
    ConversationID: string;
    ResultParameters?: { ResultParameter: { Key: string; Value?: string | number }[] };
  };
};

export function parseB2cResult(cb: B2cCallback) {
  const items = cb.Result.ResultParameters?.ResultParameter ?? [];
  const get = (name: string) => items.find((i) => i.Key === name)?.Value;
  return { mpesaReceiptNumber: get("TransactionReceipt") as string | undefined };
}
