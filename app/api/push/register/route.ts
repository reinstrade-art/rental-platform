import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/lib/auth";
import { registerDeviceToken } from "@/app/lib/push";

/**
 * Called once by the Android shell right after PushNotifications.register()
 * hands it a token — see the client-side registration script. Any signed-in
 * session may call this (tenant, staff, or tradesman all get pushes), the
 * only requirement is being signed in at all.
 */
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });

  await registerDeviceToken(s.userId, token);
  return NextResponse.json({ ok: true });
}
