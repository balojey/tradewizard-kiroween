import type { ReactNode } from "react";

type Tone = "neutral" | "accent" | "yes" | "no" | "warning" | "ai";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted border-border-strong/60",
  accent: "bg-accent-soft text-accent border-accent-line/40",
  yes: "bg-yes-soft text-yes border-yes/25",
  no: "bg-no-soft text-no border-no/25",
  warning: "bg-warning-soft text-warning border-warning/25",
  ai: "bg-ai-soft text-ai border-ai/25",
};

const DOTS: Record<Tone, string> = {
  neutral: "bg-faint",
  accent: "bg-accent",
  yes: "bg-yes",
  no: "bg-no",
  warning: "bg-warning",
  ai: "bg-ai",
};

/**
 * Squared tags, not pills: status should read as a measurement, not a reward.
 * `dot` adds a leading state marker for dense tables.
 */
export function Badge({
  tone = "neutral",
  children,
  className = "",
  dot = false,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-px text-[10.5px] font-medium leading-[1.45]",
        TONES[tone],
        className,
      ].join(" ")}
    >
      {dot && <span aria-hidden className={`h-1 w-1 rounded-full ${DOTS[tone]}`} />}
      {children}
    </span>
  );
}
