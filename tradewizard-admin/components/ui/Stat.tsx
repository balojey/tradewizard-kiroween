import type { ReactNode } from "react";

type Tone = "neutral" | "yes" | "no" | "warning" | "accent";

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-fg",
  yes: "text-yes",
  no: "text-no",
  warning: "text-warning",
  accent: "text-accent",
};

const TONE_STROKE: Record<Tone, string> = {
  neutral: "var(--accent)",
  yes: "var(--yes)",
  no: "var(--no)",
  warning: "var(--warning)",
  accent: "var(--accent)",
};

export function Sparkline({
  values,
  tone = "neutral",
  width = 76,
  height = 22,
}: {
  values: number[];
  tone?: Tone;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = width / (values.length - 1);

  const points = values.map((value, index) => {
    const x = index * step;
    const y = height - 2 - ((value - min) / span) * (height - 4);
    return [x, y] as const;
  });

  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `0,${height} ${line} ${width},${height}`;
  const stroke = TONE_STROKE[tone];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      className="shrink-0 overflow-visible"
    >
      <polygon points={area} fill={stroke} opacity={0.12} />
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * StatCard — a single number with its label, context and optional trend.
 *
 * Numbers are the loudest thing in the card; everything else is support.
 */
export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
  badge,
  sparkline,
  sparklineTone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  badge?: ReactNode;
  sparkline?: number[];
  sparklineTone?: Tone;
}) {
  return (
    <div className="rounded-[10px] border border-border bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11.5px] text-muted">{label}</span>
        {badge}
      </div>

      <div className="mt-1 flex items-end justify-between gap-3">
        <span
          className={[
            "num truncate text-[22px] font-medium leading-none tracking-[-0.015em]",
            TONE_TEXT[tone],
          ].join(" ")}
        >
          {value}
        </span>
        {sparkline && sparkline.length > 1 && (
          <Sparkline values={sparkline} tone={sparklineTone} />
        )}
      </div>

      {hint && <div className="mt-1.5 truncate text-[11px] text-faint">{hint}</div>}
    </div>
  );
}

export function StatGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={["grid gap-3 sm:grid-cols-2 lg:grid-cols-4", className].join(" ")}>
      {children}
    </div>
  );
}
