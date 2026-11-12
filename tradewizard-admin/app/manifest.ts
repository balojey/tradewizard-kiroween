import type { MetadataRoute } from "next";

/**
 * Installable portal.
 *
 * `start_url` is the overview because that is where an operator starts; the
 * route guard still sends an unauthenticated install to /login?next=/overview.
 * The service worker is deliberately conservative — see public/sw.js.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "TradeWizard Warden",
    short_name: "Warden",
    description:
      "Operations control plane for TradeWizard: analyses, accounts, billing and autonomous portfolio managers.",
    start_url: "/overview",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0e1116",
    theme_color: "#0e1116",
    lang: "en",
    dir: "ltr",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
    shortcuts: [
      {
        name: "Users",
        short_name: "Users",
        description: "Find an account",
        url: "/users",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Portfolio",
        short_name: "Portfolio",
        description: "Sessions and exposure",
        url: "/portfolio",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Ops",
        short_name: "Ops",
        description: "Queues, errors and alarms",
        url: "/ops",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
