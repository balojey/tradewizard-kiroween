"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; text: string; bytes: number }
  | { status: "error"; message: string };

/**
 * Renders the analysis payload fetched directly from S3 with a short-lived
 * presigned URL.
 *
 * Loading is explicit: payloads can be large, and nobody should pay for one by
 * opening a row they were only skimming.
 */
export function PayloadViewer({ url }: { url: string | null }) {
  const [state, setState] = useState<LoadState>({ status: "idle" });

  async function load() {
    if (!url) return;
    setState({ status: "loading" });

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          response.status === 403
            ? "This link expired (they last 60 seconds). Reload the page to get a new one."
            : `S3 responded ${response.status}`
        );
      }
      const raw = await response.text();
      let text = raw;
      try {
        text = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        // Leave non-JSON payloads as-is rather than hiding them.
      }
      setState({ status: "ready", text, bytes: raw.length });
    } catch (error) {
      setState({ status: "error", message: (error as Error).message });
    }
  }

  if (!url) {
    return (
      <p className="text-xs text-muted">
        No payload key recorded for this execution — the result row exists without one.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={load} loading={state.status === "loading"}>
          {state.status === "ready" ? "Reload payload" : "Load payload"}
        </Button>

        {state.status === "ready" && (
          <>
            <span className="text-[11px] text-muted">{Math.round(state.bytes / 1024)} KB</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void navigator.clipboard.writeText(state.text)}
            >
              Copy JSON
            </Button>
          </>
        )}

        <span className="text-[11px] text-muted">Link expires 60s after the page loaded</span>
      </div>

      {state.status === "error" && (
        <p className="rounded-[8px] border border-no/40 bg-no/10 p-3 text-xs text-fg">
          {state.message}
        </p>
      )}

      {state.status === "ready" && (
        <pre className="max-h-[560px] overflow-auto rounded-[10px] border border-border bg-surface-2 p-4 text-[11px] leading-relaxed text-fg">
          {state.text}
        </pre>
      )}
    </div>
  );
}
