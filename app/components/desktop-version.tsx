"use client";

import { useEffect, useState } from "react";

declare global {
  interface Window {
    desktopApp?: { getVersion: () => Promise<string> };
  }
}

/**
 * Shows the installed desktop app's own version, read through the preload
 * bridge the Electron shell (rental-platform-desktop) exposes on every page
 * it loads — including this live website. Renders nothing on the web app
 * or the mobile app, where window.desktopApp simply doesn't exist. Mainly
 * useful right after an auto-update, to confirm the new version actually
 * landed on this device without digging into Explorer's file properties.
 */
export function DesktopVersion() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    window.desktopApp?.getVersion().then(setVersion).catch(() => {});
  }, []);

  if (!version) return null;

  return (
    <div className="max-w-md">
      <h2 className="text-lg font-semibold">Desktop app</h2>
      <p className="mt-1 text-xs text-silver-dark">Version {version} on this device — updates itself in the background.</p>
    </div>
  );
}
