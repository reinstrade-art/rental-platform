import { NextResponse } from "next/server";
import crypto from "crypto";
import { cookies } from "next/headers";
import { getSession, requireOrgAdmin } from "@/app/lib/auth";
import { quickbooksAppConfigured, quickbooksAuthorizeUrl } from "@/app/lib/quickbooks";

const STATE_COOKIE = "qb_oauth_state";

/**
 * Starts the OAuth handoff. `state` is a random nonce stashed in a
 * short-lived cookie, not the organizationId itself — the callback re-reads
 * the org from the still-live session on return, using state only to
 * confirm this is the same browser that started the flow, never as an
 * identifier an attacker could substitute their own org into.
 */
export async function GET() {
  const s = await getSession();
  if (!requireOrgAdmin(s)) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  if (!quickbooksAppConfigured()) {
    return NextResponse.json({ error: "QuickBooks is not configured on this platform yet." }, { status: 503 });
  }

  const state = crypto.randomUUID();
  (await cookies()).set(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });

  return NextResponse.redirect(quickbooksAuthorizeUrl(state));
}
