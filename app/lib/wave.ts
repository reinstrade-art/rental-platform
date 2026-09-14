import "server-only";
import { prisma } from "./prisma";

/**
 * Wave (waveapps.com) OAuth2 + GraphQL — the PLATFORM's own accounting
 * connection, not an org's. See PlatformAccountingConnection in
 * schema.prisma for why this is a separate table from AccountingConnection:
 * that one is an org's own customer books; this is the operator's own —
 * license revenue in, commission payouts out. One Wave developer app
 * (WAVE_CLIENT_ID/SECRET) for the whole platform, same shape as
 * QUICKBOOKS_CLIENT_ID/SECRET in quickbooks.ts, registered once at
 * developer.waveapps.com by whoever runs this platform.
 *
 * Endpoint/shape references: Wave's own developer docs
 * (developer.waveapps.com) were not reachable while writing this, so the
 * OAuth endpoints and the moneyTransactionCreate input shape below are
 * assembled from Wave's own community/support pages and third-party
 * integration write-ups rather than the primary docs directly. Everything
 * here fails loudly (a FAILED PlatformAccountingSyncLog row with Wave's own
 * error text, never a silent gap) — if a field name has drifted from
 * Wave's current schema, that's where it will show up, and is worth
 * checking against the API Playground at developer.waveapps.com first.
 */

const AUTH_URL = "https://api.waveapps.com/oauth2/authorize/";
const TOKEN_URL = "https://api.waveapps.com/oauth2/token/";
const GRAPHQL_URL = "https://gql.waveapps.com/graphql/public";

// resource:operation pairs — write is never implied by read, so both are
// requested per resource this integration touches. offline_access is what
// makes Wave hand back a refresh_token at all.
const SCOPES = [
  "business:read",
  "account:read",
  "transaction:read",
  "transaction:write",
  "offline_access",
].join(" ");

export function waveAppConfigured(): boolean {
  return Boolean(process.env.WAVE_CLIENT_ID && process.env.WAVE_CLIENT_SECRET);
}

function redirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return `${base}/api/platform/wave/callback`;
}

/** `state` is a random nonce round-tripped through a cookie, the same pattern as the QuickBooks connect route — never an identifier trusted on its own. */
export function waveAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.WAVE_CLIENT_ID!,
    response_type: "code",
    scope: SCOPES,
    redirect_uri: redirectUri(),
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

type TokenResponse = { access_token: string; refresh_token: string; expires_in: number };

async function requestToken(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `Wave token request failed (${res.status}).`);
  }
  return data as TokenResponse;
}

export function exchangeWaveCode(code: string): Promise<TokenResponse> {
  return requestToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: process.env.WAVE_CLIENT_ID!,
      client_secret: process.env.WAVE_CLIENT_SECRET!,
      redirect_uri: redirectUri(),
    }),
  );
}

function refreshWaveToken(refreshToken: string): Promise<TokenResponse> {
  return requestToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.WAVE_CLIENT_ID!,
      client_secret: process.env.WAVE_CLIENT_SECRET!,
    }),
  );
}

/** The single platform connection row, refreshing and persisting a new access token first if it's within 5 minutes of expiry. */
async function freshConnection() {
  const conn = await prisma.platformAccountingConnection.findUnique({ where: { id: "default" } });
  if (!conn) throw new Error("Wave is not connected yet.");
  if (conn.expiresAt.getTime() - Date.now() > 5 * 60_000) return conn;

  const refreshed = await refreshWaveToken(conn.refreshToken);
  return prisma.platformAccountingConnection.update({
    where: { id: "default" },
    data: {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
    },
  });
}

type GraphQlResponse<T> = { data?: T; errors?: { message: string }[] };

async function waveGraphQL<T>(accessToken: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as GraphQlResponse<T>;
  if (!res.ok || json.errors?.length) {
    throw new Error(json.errors?.map((e) => e.message).join("; ") || `Wave rejected the request (${res.status}).`);
  }
  return json.data as T;
}

export type WaveAccount = { id: string; name: string; type: string; subtype: string | null };
export type WaveBusiness = { id: string; name: string; accounts: WaveAccount[] };

const BUSINESSES_QUERY = `
  query PlatformWaveBusinesses {
    user {
      businesses(page: 1, pageSize: 20) {
        edges {
          node {
            id
            name
            accounts(page: 1, pageSize: 200) {
              edges { node { id name type subtype } }
            }
          }
        }
      }
    }
  }
`;

async function listBusinesses(accessToken: string): Promise<WaveBusiness[]> {
  const data = await waveGraphQL<{ user: { businesses: { edges: { node: { id: string; name: string; accounts: { edges: { node: WaveAccount }[] } } }[] } } }>(
    accessToken,
    BUSINESSES_QUERY,
  );
  return data.user.businesses.edges.map((e) => ({
    id: e.node.id,
    name: e.node.name,
    accounts: e.node.accounts.edges.map((a) => a.node),
  }));
}

/** Called right after OAuth exchange — picks the first business on the connected Wave account (the common case for a single-business bookkeeping login) so the connect flow needs no extra picker step. */
export async function firstWaveBusiness(accessToken: string): Promise<WaveBusiness> {
  const businesses = await listBusinesses(accessToken);
  if (businesses.length === 0) throw new Error("This Wave account has no businesses to connect.");
  return businesses[0];
}

/** For the settings page's account pickers — the connected business's current chart of accounts, re-fetched live rather than cached, since accounts can be added on Wave's side at any time. */
export async function currentWaveBusiness(): Promise<WaveBusiness> {
  const conn = await freshConnection();
  const businesses = await listBusinesses(conn.accessToken);
  const business = businesses.find((b) => b.id === conn.businessId);
  if (!business) throw new Error("The connected Wave business is no longer accessible with this login.");
  return business;
}

const MONEY_TRANSACTION_CREATE = `
  mutation PlatformWaveMoneyTransactionCreate($input: MoneyTransactionCreateInput!) {
    moneyTransactionCreate(input: $input) {
      didSucceed
      inputErrors { message code path }
      transaction { id }
    }
  }
`;

type MoneyTransactionCreateResult = {
  moneyTransactionCreate: {
    didSucceed: boolean;
    inputErrors?: { message: string; code: string; path: string[] }[];
    transaction?: { id: string };
  };
};

/**
 * Posts one LicensePayment (income) or Payout (expense) as a Wave money
 * transaction. The bank account is the "anchor" — the account whose own
 * balance actually moves — with the income/expense account as the
 * transaction's one line item on the other side, standard double-entry
 * either way:
 *   income:  bank DEPOSIT   + income account  INCREASE
 *   expense: bank WITHDRAWAL + expense account INCREASE
 * `externalId` is this app's own LicensePayment/Payout id — Wave's own
 * idempotency key, so retrying a sync after a network failure can't double
 * post the same transaction.
 */
export async function postMoneyTransactionToWave(opts: {
  kind: "INCOME" | "EXPENSE";
  amount: number;
  date: Date;
  description: string;
  externalId: string;
}): Promise<{ externalId: string }> {
  const conn = await freshConnection();
  if (!conn.bankAccountId) throw new Error("Set the bank account for the Wave connection first.");
  const lineAccountId = opts.kind === "INCOME" ? conn.incomeAccountId : conn.expenseAccountId;
  if (!lineAccountId) {
    throw new Error(`Set the ${opts.kind === "INCOME" ? "income" : "expense"} account for the Wave connection first.`);
  }

  const amount = opts.amount.toFixed(2);
  const data = await waveGraphQL<MoneyTransactionCreateResult>(conn.accessToken, MONEY_TRANSACTION_CREATE, {
    input: {
      businessId: conn.businessId,
      externalId: opts.externalId,
      date: opts.date.toISOString().slice(0, 10),
      description: opts.description,
      anchor: {
        accountId: conn.bankAccountId,
        amount,
        direction: opts.kind === "INCOME" ? "DEPOSIT" : "WITHDRAWAL",
      },
      lineItems: [{ accountId: lineAccountId, amount, balance: "INCREASE" }],
    },
  });

  const result = data.moneyTransactionCreate;
  if (!result.didSucceed || !result.transaction?.id) {
    throw new Error(result.inputErrors?.map((e) => e.message).join("; ") || "Wave rejected the transaction.");
  }
  return { externalId: result.transaction.id };
}
