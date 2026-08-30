import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";

/**
 * Serves the desktop app's auto-update files (latest.yml, the installer,
 * its blockmap) publicly, without a session -- electron-updater has no
 * cookies to send. The underlying Blob store is private-only (it also
 * holds tenant message attachments, which must stay private), so this is a
 * narrow, deliberate public window onto exactly one prefix rather than a
 * store-wide access change. Matches the stable path electron-builder's
 * `publish.url` and scripts/publish-desktop-update.mjs both target:
 * desktop-updates/<filename>, no auth, overwritten in place each release.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;
  const filename = segments.join("/");
  // Confines this route to its own prefix even though Blob itself doesn't
  // enforce that -- an empty/traversal-y segment shouldn't resolve to some
  // unrelated private object elsewhere in the same store.
  if (!filename || filename.includes("..")) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const blob = await get(`desktop-updates/${filename}`, { access: "private" }).catch(() => null);
  if (!blob || blob.statusCode !== 200) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return new NextResponse(blob.stream, {
    headers: {
      "Content-Type": filename.endsWith(".yml") ? "text/yaml" : "application/octet-stream",
      "Content-Length": String(blob.blob.size ?? ""),
      // Update files are overwritten in place on every release -- a CDN or
      // browser cache holding onto a stale latest.yml would silently stop
      // landlords from ever seeing a new version.
      "Cache-Control": "no-store",
    },
  });
}
