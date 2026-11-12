"use client";

import Link from "next/link";
import { ArrowUpRight, Crosshair } from "lucide-react";
import type { CopilotSuggestedAction } from "@/types/admin";

/**
 * Suggested actions are links, never buttons. There is no execute variant
 * because the copilot has no mutation path; the human clicks an existing control.
 */
export function SuggestedActions({ actions }: { actions: CopilotSuggestedAction[] }) {
  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10.5px] uppercase tracking-[0.06em] text-faint">Where to look</span>

      {actions.map((action) => (
        <Link
          key={`${action.kind}:${action.url}`}
          href={action.url}
          className={[
            "inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-0.5 text-[10.5px] transition-colors",
            action.kind === "review"
              ? "border-accent-line/50 bg-accent-soft text-accent hover:border-accent"
              : "border-border-strong/60 bg-surface-2 text-muted hover:border-accent-line/50 hover:text-fg",
          ].join(" ")}
        >
          <Crosshair size={10} aria-hidden className="shrink-0" />
          {action.label}
          <ArrowUpRight size={10} aria-hidden className="shrink-0 opacity-70" />
        </Link>
      ))}
    </div>
  );
}
