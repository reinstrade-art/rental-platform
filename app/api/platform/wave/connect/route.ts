import { NextResponse } from "next/server";
import crypto from "crypto";
import { cookies } from "next/headers";
import { getSession, requirePlatformAdmin } from "@/app/lib/auth";
import { waveAppConfigured, waveAuthorizeUrl } from "@/app/lib/wave";

const STATE_COOKIE = "wave_oauth_state";

/** Starts the OAuth handoff — same state-cookie shape as the QuickBooks connect route (app/api/accounting/quickbooks/connect), but platform-admin gated rather than org-admin, since this connects the operator's own Wave business. */
export async function GET() {
  const s = await getSession();
  if (!requirePlatformAdmin(s)) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  if (!waveAppConfigured()) {
    return NextResponse.json({ error: "Wave is not configured on this platform yet." }, { status: 503 });
  }

  const state = crypto.randomUUID();
  (await cookies()).set(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });

  return NextResponse.redirect(waveAuthorizeUrl(state));
}
