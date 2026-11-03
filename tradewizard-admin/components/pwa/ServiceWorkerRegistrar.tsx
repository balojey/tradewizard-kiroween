"use client";

import { useEffect } from "react";

/**
 * Registers the portal's service worker.
 *
 * Production only: in development the App Router serves unminified, unhashed
 * chunks behind HMR, and a stale-while-revalidate cache would hand the browser
 * yesterday's module graph. Installing the PWA is a progressive enhancement, so
 * a failed registration is swallowed rather than surfaced as an app error.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    function register() {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // No worker means no offline fallback; the portal itself still works.
      });
    }

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
