"use client";

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className = "",
}: {
  items: ReadonlyArray<{ key: T; label: string; count?: number }>;
  value: T;
  onChange: (key: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={["flex gap-0.5 overflow-x-auto border-b border-border", className].join(" ")}
    >
      {items.map((item) => {
        const active = item.key === value;

        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.key)}
            className={[
              "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-[12.5px] transition-colors",
              active
                ? "border-accent text-fg"
                : "border-transparent text-muted hover:border-border-strong hover:text-fg",
            ].join(" ")}
          >
            {item.label}
            {item.count !== undefined && (
              <span className="num rounded-[4px] bg-surface-2 px-1 text-[10.5px] text-muted">
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Compact option switcher for windows, density and similar small choices. */
export function Segmented<T extends string | number>({
  items,
  value,
  onChange,
  label,
}: {
  items: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex h-8 items-center rounded-[7px] border border-border bg-surface p-0.5"
    >
      {items.map((item) => {
        const active = item.value === value;

        return (
          <button
            key={String(item.value)}
            type="button"
            onClick={() => onChange(item.value)}
            aria-pressed={active}
            className={[
              "h-full rounded-[5px] px-2.5 text-[11.5px] transition-colors",
              active
                ? "bg-surface-elevated font-medium text-fg"
                : "text-muted hover:text-fg",
            ].join(" ")}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
