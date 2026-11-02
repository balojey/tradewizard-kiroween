import type { ReactNode } from "react";

/**
 * Panel — the one container used across the portal.
 *
 * Hairline header rule, no drop shadow, no gradient: panels group data, they do
 * not compete with it.
 */
export function Panel({
  title,
  description,
  actions,
  footer,
  children,
  className = "",
  bodyClassName = "",
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const hasHeader = Boolean(title || description || actions);

  return (
    <section
      className={[
        "overflow-hidden rounded-[10px] border border-border bg-surface",
        className,
      ].join(" ")}
    >
      {hasHeader && (
        <header className="flex items-start justify-between gap-4 border-b border-border-soft px-4 py-3">
          <div className="min-w-0">
            {title && (
              <h2 className="truncate text-[13px] font-medium leading-tight text-fg">{title}</h2>
            )}
            {description && (
              <p className="mt-1 max-w-[72ch] text-[11.5px] leading-relaxed text-muted">
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}

      <div className={["px-4 py-3.5", bodyClassName].join(" ")}>{children}</div>

      {footer && (
        <footer className="flex items-center justify-between gap-3 border-t border-border-soft px-4 py-2.5">
          {footer}
        </footer>
      )}
    </section>
  );
}

/** Back-compat alias: older views import `Card`. */
export const Card = Panel;

export function Field({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border-soft py-2 last:border-0">
      <span className="shrink-0 text-xs text-muted">{label}</span>
      <span
        className={[
          "min-w-0 text-right text-[12.5px] text-fg",
          mono ? "mono truncate text-[11.5px]" : "",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}
