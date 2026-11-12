"use client";

import Link from "next/link";
import {
  Activity,
  BookOpen,
  FileSearch,
  Inbox,
  Settings2,
  Wallet,
} from "lucide-react";
import type { CopilotCitation, CopilotCitationType } from "@/types/admin";

const ICONS: Record<CopilotCitationType, typeof Activity> = {
  audit: FileSearch,
  ticket: Inbox,
  analysis: FileSearch,
  session: Wallet,
  setting: Settings2,
  metric: Activity,
  runbook: BookOpen,
};

/**
 * Citation chips. Each chip links to the exact record the answer used; that
 * click-through is the proof the answer is grounded.
 */
export function CitationList({ citations }: { citations: CopilotCitation[] }) {
  if (citations.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10.5px] uppercase tracking-[0.06em] text-faint">Sources</span>

      {citations.map((citation) => {
        const Icon = ICONS[citation.type] ?? FileSearch;

        return (
          <Link
            key={`${citation.type}:${citation.id}`}
            href={citation.url}
            title={`${citation.type}: ${citation.id}`}
            aria-label={`${citation.type} citation: ${citation.label}`}
            className="inline-flex max-w-[280px] items-center gap-1 rounded-[4px] border border-border-strong/60 bg-surface-2 px-1.5 py-0.5 text-[10.5px] text-muted transition-colors hover:border-accent-line/50 hover:text-fg"
          >
            <Icon size={10} aria-hidden className="shrink-0 text-faint" />
            <span className="mono shrink-0 text-faint">{citation.type}</span>
            <span className="truncate">{citation.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
