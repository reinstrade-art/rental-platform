"use client";

import { useEffect } from "react";

/**
 * Mounted once in every signed-in shell (staff, tenant portal, trade portal).
 * A no-op in an ordinary browser tab — Capacitor.isNativePlatform() is only
 * ever true inside the Android app, where this WebView is what actually
 * loads realty.reinstrade.com directly (see capacitor.config.json's
 * server.url), so this is the only place client code for the native shell
 * can run at all.
 */
export function PushRegistration() {
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform()) return;

      const { PushNotifications } = await import("@capacitor/push-notifications");

      const send = (token: string) => {
        fetch("/api/push/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        }).catch(() => {});
      };

      PushNotifications.addListener("registration", (t) => {
        if (!cancelled) send(t.value);
      });
      // A token that fails to register just means no push for this device —
      // never something to surface to whoever's using the app.
      PushNotifications.addListener("registrationError", () => {});

      let permission = await PushNotifications.checkPermissions();
      if (permission.receive === "prompt" || permission.receive === "prompt-with-rationale") {
        permission = await PushNotifications.requestPermissions();
      }
      if (permission.receive === "granted" && !cancelled) {
        await PushNotifications.register();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
