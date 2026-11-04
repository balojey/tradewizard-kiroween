"use client";

import { useEffect } from "react";

/**
 * Repairs the iOS standalone-PWA viewport.
 *
 * WebKit can drop the viewport constraints for an installed web app after it is
 * backgrounded or the device is locked, and falls back to a legacy desktop
 * virtual viewport (~980 CSS px). `window.innerWidth` jumps, the desktop media
 * queries engage, and the whole app renders shrunken — "zoomed out" — until it
 * is force-quit (WebKit bug 262207).
 *
 * The mitigation is to detect a viewport far wider than the physical screen and
 * make WebKit re-parse the viewport meta. Pinch-zoom is left alone: that changes
 * `visualViewport.scale`, not `innerWidth`, so accessibility zooming never
 * trips this.
 *
 * Runs only for iOS in standalone mode; everywhere else it is a no-op.
 */

const MIN_SUSPECT_WIDTH = 700;

function isIosStandalone(): boolean {
  if (typeof window === "undefined") return false;

  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports itself as a Mac; the touch points give it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  if (!ios) return false;

  const navigatorStandalone = (navigator as Navigator & { standalone?: boolean }).standalone;
  const displayStandalone = window.matchMedia("(display-mode: standalone)").matches;

  return navigatorStandalone === true || displayStandalone;
}

export function IosViewportGuard() {
  useEffect(() => {
    if (!isIosStandalone()) return;

    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) return;

    const viewportMeta: HTMLMetaElement = meta;
    const original = viewportMeta.getAttribute("content") ?? "width=device-width, initial-scale=1";
    let resetting = false;

    function reportedDesktopViewport(): boolean {
      // The legacy fallback is ~980 CSS px. Compare it with the width this
      // orientation should have: the short side in portrait, the long side in
      // landscape. A legitimate landscape width must not look like the bug.
      const landscape =
        typeof window.screen.orientation?.type === "string"
          ? window.screen.orientation.type.startsWith("landscape")
          : window.innerWidth > window.innerHeight;

      const expectedWidth = landscape
        ? Math.max(window.screen.width, window.screen.height)
        : Math.min(window.screen.width, window.screen.height);

      return (
        window.innerWidth >= MIN_SUSPECT_WIDTH &&
        window.innerWidth > expectedWidth * 1.25
      );
    }

    function repair() {
      if (resetting || !reportedDesktopViewport()) return;

      resetting = true;
      viewportMeta.setAttribute("content", "width=device-width, initial-scale=1");

      // Re-parsing is what fixes the scale; restore the real content (and its
      // viewport-fit) on the next frame.
      window.requestAnimationFrame(() => {
        window.setTimeout(() => {
          viewportMeta.setAttribute("content", original);
          resetting = false;
        }, 50);
      });
    }

    function onVisible() {
      if (document.visibilityState === "visible") repair();
    }

    // Resume from background, back/forward cache restore, rotation, and the
    // spurious resize WebKit fires when it loses the constraint.
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", repair);
    window.addEventListener("orientationchange", repair);
    window.addEventListener("resize", repair);

    repair();

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", repair);
      window.removeEventListener("orientationchange", repair);
      window.removeEventListener("resize", repair);
    };
  }, []);

  return null;
}
