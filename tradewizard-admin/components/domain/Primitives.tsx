"use client";

import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { formatDateTime, formatRelative } from "@/lib/format";

type Tone = "neutral" | "accent" | "yes" | "no" | "warning" | "ai";

const STATUS_TONES: Record<string, Tone> = {
  active: "yes",
  succeeded: "yes",
  success: "yes",
  completed: "yes",
  LONG_YES: "yes",
  yes: "yes",
  filled: "yes",
  suspended: "warning",
  paused: "warning",
  pending: "warning",
  trial: "warning",
  exiting: "warning",
  executing: "warning",
  LONG_NO: "warning",
  failed: "no",
  failure: "no",
  banned: "no",
  terminated: "no",
  cancelled: "no",
  no: "no",
};

export function StatusPill({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-faint">—</span>;

  return (
    <Badge tone={STATUS_TONES[status] ?? "neutral"} dot>
      {status.replace(/_/g, " ").toLowerCase()}
    </Badge>
  );
}

export function PlanBadge({ plan }: { plan: string | null | undefined }) {
  if (!plan) return <span className="text-faint">—</span>;
  const tone = plan === "elite" ? "ai" : plan === "pro" ? "accent" : "neutral";
  return <Badge tone={tone}>{plan}</Badge>;
}

/**
 * Every identifier is one click from the clipboard and readable at a glance.
 * The full value stays in the tooltip and in the accessible label.
 */
export function CopyableId({
  value,
  label,
  chars = 8,
}: {
  value: string | null | undefined;
  label?: string;
  chars?: number;
}) {
  const [copied, setCopied] = useState(false);

  if (!value) return <span className="text-faint">—</span>;

  const short = value.length > chars * 2 ? `${value.slice(0, chars)}…${value.slice(-4)}` : value;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
      title={label ? `${label}: ${value}` : value}
      aria-label={`${label ?? "id"}: ${value}. Copy to clipboard.`}
      className="mono group/id inline-flex max-w-full items-center gap-1 rounded-[3px] text-[11px] text-muted transition-colors hover:text-fg"
    >
      <span className="truncate">{short}</span>
      {copied ? (
        <Check size={10} aria-hidden className="shrink-0 text-yes" />
      ) : (
        <Copy
          size={10}
          aria-hidden
          className="shrink-0 text-faint opacity-0 transition-opacity group-hover/id:opacity-100"
        />
      )}
    </button>
  );
}

/** Relative when scanning, absolute UTC on hover or focus. */
export function TimeCell({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-faint">—</span>;

  return (
    <time
      dateTime={value}
      title={formatDateTime(value)}
      className="whitespace-nowrap text-[11.5px] text-muted"
    >
      {formatRelative(value)}
    </time>
  );
}

export function Pnl({ value, suffix = "" }: { value: number | null | undefined; suffix?: string }) {
  if (value === null || value === undefined) return <span className="text-faint">—</span>;

  const tone = value > 0 ? "text-yes" : value < 0 ? "text-no" : "text-muted";

  return (
    <span className={`num text-[11.5px] ${tone}`}>
      {value > 0 ? "+" : ""}
      {value.toFixed(2)}
      {suffix}
    </span>
  );
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border-soft py-2 last:border-0">
      <span className="shrink-0 text-[11.5px] text-muted">{label}</span>
      <span className="min-w-0 truncate text-right text-[12.5px] text-fg">{children}</span>
    </div>
  );
}

/** Two-column label/value grid for detail views. */
export function KeyValueGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-x-8 sm:grid-cols-2">{children}</div>;
}
