// One-off publisher for desktop-app auto-updates: uploads electron-builder's
// dist output (the installer, its blockmap, and latest.yml) to Vercel Blob
// under stable, overwritable paths -- addRandomSuffix:false + allowOverwrite
// is what makes "https://.../desktop-updates/latest.yml" mean the same URL
// release after release, which electron-updater's generic provider requires.
// Run with: npx dotenv -e .env.local -- node scripts/publish-desktop-update.mjs <path-to-dist-dir>
import { put } from "@vercel/blob";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const distDir = process.argv[2];
if (!distDir) {
  console.error("Usage: node scripts/publish-desktop-update.mjs <path-to-desktop-app-dist-dir>");
  process.exit(1);
}

const entries = await readdir(distDir);
// Only the update-relevant files -- not builder-debug.yml or the win-unpacked/ dir.
const toUpload = entries.filter((f) => f === "latest.yml" || /\.exe(\.blockmap)?$/i.test(f));
if (!toUpload.length) {
  console.error(`No installer/blockmap/latest.yml found in ${distDir}`);
  process.exit(1);
}

for (const filename of toUpload) {
  const filePath = path.join(distDir, filename);
  const data = await readFile(filePath);
  // The store is private-only (it also holds tenant message attachments),
  // so these are fetched back out through app/desktop-updates/[...path]/
  // route.ts rather than served straight from Blob's own URL.
  const blob = await put(`desktop-updates/${filename}`, data, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: filename.endsWith(".yml") ? "text/yaml" : "application/octet-stream",
  });
  console.log(`${filename} -> ${blob.url}`);
}
