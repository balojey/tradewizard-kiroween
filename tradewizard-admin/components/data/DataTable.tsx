"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

export interface Column<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  className?: string;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  getRowHref?: (row: T) => string;
  loading?: boolean;
  emptyMessage?: string;
  emptyHint?: string;
}

/**
 * Dense data table.
 *
 * The first cell becomes a real link when rows are navigable (keyboard + middle
 * click work) and the row also responds to clicks as a convenience.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  getRowHref,
  loading = false,
  emptyMessage = "No rows match these filters.",
  emptyHint,
}: DataTableProps<T>) {
  const router = useRouter();

  return (
    <div className="overflow-x-auto rounded-[10px] border border-border bg-surface">
      <table className="w-full border-collapse text-[12.5px]">
        <thead className="bg-surface">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={[
                  "whitespace-nowrap border-b border-border px-3 py-2 text-[10.5px] font-medium uppercase tracking-[0.07em] text-faint",
                  column.align === "right" ? "text-right" : "text-left",
                ].join(" ")}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {loading &&
            Array.from({ length: 6 }).map((_, index) => (
              <tr key={`skeleton-${index}`} className="border-b border-border-soft last:border-0">
                {columns.map((column) => (
                  <td key={column.key} className="px-3 py-2.5">
                    <div className="h-2.5 w-full max-w-[150px] animate-pulse rounded-[2px] bg-surface-2" />
                  </td>
                ))}
              </tr>
            ))}

          {!loading &&
            rows.map((row) => {
              const href = getRowHref?.(row);

              return (
                <tr
                  key={getRowId(row)}
                  onClick={href ? () => router.push(href) : undefined}
                  className={[
                    "group border-b border-border-soft transition-colors last:border-0",
                    href ? "cursor-pointer hover:bg-hover" : "hover:bg-hover/50",
                  ].join(" ")}
                >
                  {columns.map((column, index) => (
                    <td
                      key={column.key}
                      className={[
                        "px-3 py-2 align-middle",
                        column.align === "right" ? "text-right tabular" : "text-left",
                        column.className ?? "",
                      ].join(" ")}
                    >
                      {href && index === 0 ? (
                        <Link
                          href={href}
                          className="block truncate text-fg transition-colors group-hover:text-accent"
                        >
                          {column.render(row)}
                        </Link>
                      ) : (
                        column.render(row)
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}

          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12">
                <div className="flex flex-col items-center gap-1.5 text-center">
                  <Inbox size={18} aria-hidden className="text-faint" />
                  <p className="text-[12.5px] text-muted">{emptyMessage}</p>
                  {emptyHint && <p className="max-w-[46ch] text-[11px] text-faint">{emptyHint}</p>}
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
