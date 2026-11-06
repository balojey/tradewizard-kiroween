import { NextRequest, NextResponse } from "next/server";
import { POLYGON_RPC_URL } from "@/constants/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Same-origin Polygon JSON-RPC proxy.
 *
 * Public RPCs are not browser-friendly:
 *  - drpc's free tier rejects batches of more than 10 with HTTP 400 (the
 *    approvals check batches exactly that way),
 *  - several public endpoints now require API keys or block browser origins.
 *
 * The client points at this route. We split large batches into safe chunks and
 * fall back across providers before returning a 502.
 */
const MAX_BATCH_SIZE = 10;
const REQUEST_TIMEOUT_MS = 4_000;

const UPSTREAMS = [
  process.env.POLYGON_RPC_URL,
  POLYGON_RPC_URL,
  "https://polygon.drpc.org",
  "https://polygon-bor-rpc.publicnode.com",
].filter(
  (url, index, all): url is string =>
    typeof url === "string" && url.trim() !== "" && all.indexOf(url) === index,
);

// Module-scope provider order. A failed upstream is demoted so a dead endpoint
// costs one timeout, not one per request, and a working one is promoted.
const upstreamOrder = [...UPSTREAMS];

function promoteUpstream(url: string): void {
  const index = upstreamOrder.indexOf(url);
  if (index > 0) {
    upstreamOrder.splice(index, 1);
    upstreamOrder.unshift(url);
  }
}

function demoteUpstream(url: string): void {
  const index = upstreamOrder.indexOf(url);
  if (index >= 0 && index < upstreamOrder.length - 1) {
    upstreamOrder.splice(index, 1);
    upstreamOrder.push(url);
  }
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

function isAllowedMethod(method: unknown): boolean {
  // Standard EVM read/write namespace only. Never expose admin/debug/txpool.
  return typeof method === "string" && /^(eth|net|web3)_/.test(method);
}

async function forward(url: string, body: string): Promise<string> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${text.slice(0, 200)}`);
  }
  return text;
}

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON-RPC request body" },
      { status: 400 },
    );
  }

  const isBatch = Array.isArray(payload);
  const requests = (isBatch ? payload : [payload]) as JsonRpcRequest[];

  if (requests.length === 0) {
    return NextResponse.json(
      { error: "Empty JSON-RPC batch" },
      { status: 400 },
    );
  }

  if (!requests.every((entry) => entry && isAllowedMethod(entry.method))) {
    return NextResponse.json(
      { error: "Unsupported JSON-RPC method" },
      { status: 403 },
    );
  }

  // Split at the provider limit. drpc's free tier is the tightest we use.
  const chunks: JsonRpcRequest[][] = [];
  for (let i = 0; i < requests.length; i += MAX_BATCH_SIZE) {
    chunks.push(requests.slice(i, i + MAX_BATCH_SIZE));
  }

  let lastError = "No Polygon RPC upstream configured";

  for (const upstream of [...upstreamOrder]) {
    try {
      const responses: unknown[] = [];

      for (const chunk of chunks) {
        const body = JSON.stringify(isBatch ? chunk : chunk[0]);
        const text = await forward(upstream, body);
        const parsed = JSON.parse(text);

        if (isBatch) {
          if (!Array.isArray(parsed)) {
            throw new Error(
              `${upstream} returned a non-array response for a batch`,
            );
          }
          responses.push(...parsed);
        } else {
          responses.push(parsed);
        }
      }

      promoteUpstream(upstream);
      return NextResponse.json(isBatch ? responses : responses[0]);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      demoteUpstream(upstream);
      console.warn(`[polygon-rpc] upstream failed: ${lastError}`);
    }
  }

  console.error(`[polygon-rpc] all upstreams failed: ${lastError}`);
  return NextResponse.json(
    { error: "Polygon RPC unavailable", detail: lastError },
    { status: 502 },
  );
}
