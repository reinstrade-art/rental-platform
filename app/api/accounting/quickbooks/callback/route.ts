import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession, requireOrgAdmin } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { exchangeQuickbooksCode } from "@/app/lib/quickbooks";

const STATE_COOKIE = "qb_oauth_state";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const realmId = req.nextUrl.searchParams.get("realmId");
  const returnedState = req.nextUrl.searchParams.get("state");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);

  if (!code || !realmId || !returnedState || returnedState !== expectedState) {
    return NextResponse.redirect(new URL("/settings?error=QuickBooks%20connection%20failed%20(state%20mismatch).", req.url));
  }

  const s = await getSession();
  if (!requireOrgAdmin(s)) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  try {
    const tokens = await exchangeQuickbooksCode(code);
    await prisma.accountingConnection.upsert({
      where: { organizationId_provider: { organizationId: s.organizationId, provider: "QUICKBOOKS" } },
      create: {
        organizationId: s.organizationId,
        provider: "QUICKBOOKS",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        realmId,
        connectedBy: s.userId,
      },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        realmId,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not connect to QuickBooks.";
    return NextResponse.redirect(new URL(`/settings?error=${encodeURIComponent(message)}`, req.url));
  }

  return NextResponse.redirect(new URL("/settings?qbConnected=1", req.url));
}
