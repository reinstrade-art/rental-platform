import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession, requirePlatformAdmin } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { exchangeWaveCode, firstWaveBusiness } from "@/app/lib/wave";

const STATE_COOKIE = "wave_oauth_state";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const returnedState = req.nextUrl.searchParams.get("state");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);

  if (!code || !returnedState || returnedState !== expectedState) {
    return NextResponse.redirect(new URL("/platform/accounting?error=Wave%20connection%20failed%20(state%20mismatch).", req.url));
  }

  const s = await getSession();
  if (!requirePlatformAdmin(s)) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  try {
    const tokens = await exchangeWaveCode(code);
    const business = await firstWaveBusiness(tokens.access_token);

    await prisma.platformAccountingConnection.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        businessId: business.id,
        connectedBy: s.userId,
      },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        businessId: business.id,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not connect to Wave.";
    return NextResponse.redirect(new URL(`/platform/accounting?error=${encodeURIComponent(message)}`, req.url));
  }

  return NextResponse.redirect(new URL("/platform/accounting?waveConnected=1", req.url));
}
