import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-[11.5px] text-faint">
        {items.map((item, index) => {
          const last = index === items.length - 1;

          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1">
              {index > 0 && <ChevronRight size={11} aria-hidden className="text-border-strong" />}
              {item.href && !last ? (
                <Link href={item.href} className="transition-colors hover:text-fg">
                  {item.label}
                </Link>
              ) : (
                <span className={last ? "text-muted" : ""} aria-current={last ? "page" : undefined}>
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * PageHeader — every page opens the same way: optional crumbs, a title, one
 * sentence of orientation, actions on the right, and a meta line for counts or
 * timestamps. Keeps detail pages and list pages spatially consistent.
 */
export function PageHeader({
  title,
  description,
  crumbs,
  actions,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  crumbs?: Crumb[];
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="mb-5">
      {crumbs && crumbs.length > 0 && <Breadcrumbs items={crumbs} />}

      <div className="mt-1.5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="truncate text-[19px] font-medium leading-tight tracking-[-0.012em] text-fg">
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 max-w-[75ch] text-[12.5px] leading-relaxed text-muted">
              {description}
            </p>
          )}
        </div>

        {actions && (
          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">{actions}</div>
        )}
      </div>

      {meta && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-muted">
          {meta}
        </div>
      )}
    </header>
  );
}

/** Content column. One width for the whole portal keeps scanning predictable. */
export function Page({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={["mx-auto w-full max-w-[1240px]", className].join(" ")}>{children}</div>
  );
}
