import "server-only";
import { prisma } from "./prisma";

/**
 * QuickBooks Online OAuth2 + journal-entry sync. One app-wide Intuit
 * developer app (QUICKBOOKS_CLIENT_ID/SECRET) is shared by every org — the
 * per-org distinction is the realmId (their company) and their own
 * access/refresh tokens, not a separate app registration each. Sandbox vs
 * production is chosen by QUICKBOOKS_ENV, matching the app's own M-Pesa env
 * convention.
 */

function authBase() {
  return "https://appcenter.intuit.com/connect/oauth2";
}
function tokenUrl() {
  return "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
}
function apiBase() {
  return process.env.QUICKBOOKS_ENV === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

export function quickbooksAppConfigured(): boolean {
  return Boolean(process.env.QUICKBOOKS_CLIENT_ID && process.env.QUICKBOOKS_CLIENT_SECRET);
}

function redirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return `${base}/api/accounting/quickbooks/callback`;
}

/** `state` carries the organizationId through the redirect — Intuit hands it back unchanged. */
export function quickbooksAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.QUICKBOOKS_CLIENT_ID!,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: redirectUri(),
    state,
  });
  return `${authBase()}?${params.toString()}`;
}

type TokenResponse = { access_token: string; refresh_token: string; expires_in: number };

export async function exchangeQuickbooksCode(code: string): Promise<TokenResponse> {
  const auth = Buffer.from(`${process.env.QUICKBOOKS_CLIENT_ID}:${process.env.QUICKBOOKS_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(tokenUrl(), {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri() }),
  });
  if (!res.ok) throw new Error(`QuickBooks token exchange failed (${res.status}).`);
  return res.json();
}

async function refreshQuickbooksToken(refreshToken: string): Promise<TokenResponse> {
  const auth = Buffer.from(`${process.env.QUICKBOOKS_CLIENT_ID}:${process.env.QUICKBOOKS_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(tokenUrl(), {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error(`QuickBooks token refresh failed (${res.status}).`);
  return res.json();
}

/** Returns a connection with a definitely-fresh access token, refreshing and persisting it first if it's within 5 minutes of expiry. */
async function freshConnection(connectionId: string) {
  const conn = await prisma.accountingConnection.findUniqueOrThrow({ where: { id: connectionId } });
  if (conn.expiresAt.getTime() - Date.now() > 5 * 60_000) return conn;

  const refreshed = await refreshQuickbooksToken(conn.refreshToken);
  return prisma.accountingConnection.update({
    where: { id: connectionId },
    data: {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
    },
  });
}

/**
 * Posts one payment as a two-line JournalEntry: debit the org's chosen bank
 * account, credit their chosen income account. Deliberately not a
 * SalesReceipt/Invoice against a Customer+Item — that needs the org's
 * tenants and units mirrored as QuickBooks Customers/Items first, real
 * mapping work this MVP doesn't attempt; a journal entry is the simplest
 * artifact that lands the amount in the right two accounts and is legible
 * to an accountant either way.
 */
export async function syncPaymentToQuickbooks(connectionId: string, payment: {
  id: string;
  amount: number;
  paidAt: Date;
  description: string;
}): Promise<{ externalId: string }> {
  const conn = await freshConnection(connectionId);
  if (!conn.incomeAccountId || !conn.bankAccountId) {
    throw new Error("Set the income and bank account IDs for this QuickBooks connection first.");
  }

  const body = {
    TxnDate: payment.paidAt.toISOString().slice(0, 10),
    PrivateNote: payment.description,
    Line: [
      {
        DetailType: "JournalEntryLineDetail",
        Amount: payment.amount,
        JournalEntryLineDetail: { PostingType: "Debit", AccountRef: { value: conn.bankAccountId } },
      },
      {
        DetailType: "JournalEntryLineDetail",
        Amount: payment.amount,
        JournalEntryLineDetail: { PostingType: "Credit", AccountRef: { value: conn.incomeAccountId } },
      },
    ],
  };

  const res = await fetch(`${apiBase()}/v3/company/${conn.realmId}/journalentry`, {
    method: "POST",
    headers: { Authorization: `Bearer ${conn.accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { JournalEntry?: { Id?: string }; Fault?: { Error?: { Message?: string }[] } };
  if (!res.ok || !data.JournalEntry?.Id) {
    throw new Error(data.Fault?.Error?.[0]?.Message ?? `QuickBooks rejected the entry (${res.status}).`);
  }
  return { externalId: data.JournalEntry.Id };
}
