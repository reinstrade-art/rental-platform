import { NextRequest, NextResponse } from "next/server";

// The dedicated public Blob store for desktop-app update files (installer,
// blockmap, latest.yml) -- separate from the main private store that holds
// tenant message attachments. Its base URL is not a secret (it's the public
// CDN address of public objects); only *writing* to it needs the
// DESKTOP_UPDATES_READ_WRITE_TOKEN used by scripts/publish-desktop-update.mjs
// in CI, never by this route.
const PUBLIC_STORE_BASE = "https://fkmuxaym0yuzvztg.public.blob.vercel-storage.com";

/**
 * Redirects to the desktop app's auto-update files rather than proxying
 * their bytes through this route. The first version of this route streamed
 * a private blob through a Vercel serverless function -- which silently
 * truncated the ~115MB installer to 0 bytes, because serverless function
 * responses are capped around 4.5MB. A redirect's response is tiny
 * regardless of the target file's size, and the actual transfer happens
 * directly from Blob's own CDN to the client.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;
  const filename = segments.join("/");
  if (!filename || filename.includes("..")) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return NextResponse.redirect(`${PUBLIC_STORE_BASE}/desktop-updates/${filename}`, {
    status: 302,
    headers: {
      // Update files are overwritten in place on every release -- a cached
      // redirect (or a cached latest.yml past it) would silently stop
      // landlords from ever seeing a new version.
      "Cache-Control": "no-store",
    },
  });
}
