"use client";

import { useEffect, useState } from "react";

declare global {
  interface Window {
    desktopApp?: { getVersion: () => Promise<string> };
  }
}

type State =
  | { status: "checking" }
  | { status: "not-desktop" }
  | { status: "ok"; version: string }
  | { status: "error"; message: string };

function initialState(): State {
  // typeof window guards the server-render pass client components still get
  // for their initial HTML — both branches render null, so there's nothing
  // for hydration to mismatch on.
  return typeof window !== "undefined" && window.desktopApp ? { status: "checking" } : { status: "not-desktop" };
}

/**
 * Shows the installed desktop app's own version, read through the preload
 * bridge the Electron shell (rental-platform-desktop) exposes on every page
 * it loads — including this live website. Renders nothing on the web app
 * or the mobile app, where window.desktopApp simply doesn't exist. Mainly
 * useful right after an auto-update, to confirm the new version actually
 * landed on this device without digging into Explorer's file properties.
 *
 * Deliberately surfaces the "error" state rather than just staying blank on
 * any failure — a component that renders nothing on every failure mode
 * looks identical to one that's working correctly but hasn't run yet,
 * which made a real preload/IPC problem indistinguishable from "you're
 * just looking at the web app."
 */
export function DesktopVersion() {
  const [state, setState] = useState<State>(initialState);

  useEffect(() => {
    if (state.status !== "checking") return;
    window.desktopApp!
      .getVersion()
      .then((version) => setState({ status: "ok", version }))
      .catch((e) => setState({ status: "error", message: e instanceof Error ? e.message : String(e) }));
  }, [state.status]);

  if (state.status === "checking" || state.status === "not-desktop") return null;

  return (
    <div className="max-w-md">
      <h2 className="text-lg font-semibold">Desktop app</h2>
      {state.status === "ok" ? (
        <p className="mt-1 text-xs text-silver-dark">Version {state.version} on this device — updates itself in the background.</p>
      ) : (
        <p className="mt-1 text-xs text-red-700">Couldn&apos;t read the installed version: {state.message}</p>
      )}
    </div>
  );
}
