// Polymarket API URLs
export const RELAYER_URL = "https://relayer-v2.polymarket.com/";
export const CLOB_API_URL = "https://clob.polymarket.com";
export const GEOBLOCK_API_URL = "https://polymarket.com/api/geoblock";
export const GAMMA_API_URL = "https://gamma-api.polymarket.com";
export const POLYMARKET_PROFILE_URL = (address: string) =>
  `https://polymarket.com/${address}`;

// RPC
export const POLYGON_RPC_URL =
  process.env.NEXT_PUBLIC_POLYGON_RPC_URL || "https://polygon.drpc.org";

/**
 * RPC URL for browser-side clients.
 *
 * Public RPC providers reject or rate-limit the browser directly (drpc's free
 * tier rejects batches over 10, for example). Route browser calls through our
 * same-origin proxy, which splits batches and falls back across providers.
 * Server-side callers keep using the direct URL.
 */
export function getPolygonRpcUrl(): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/api/polygon-rpc`;
  }
  return POLYGON_RPC_URL;
}

// Remote signing endpoint
export const REMOTE_SIGNING_URL = () =>
  typeof window !== "undefined"
    ? `${window.location.origin}/api/polymarket/sign`
    : "/api/polymarket/sign";

