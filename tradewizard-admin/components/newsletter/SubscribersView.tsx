"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { DataTable, type Column } from "@/components/data/DataTable";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/Stat";
import { useCursorStack } from "@/hooks/useCursorStack";
import { useNewsletterSummary, useSubscribers } from "@/hooks/useNewsletter";
import { formatDateTime } from "@/lib/format";
import type { NewsletterSubscriber } from "@/types/admin";

export function SubscribersView() {
  const { data: summary } = useNewsletterSummary();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const filters = useMemo(() => ({ status, q }), [status, q]);
  const cursorStack = useCursorStack(`${status}|${q}`);
  const { data, isLoading } = useSubscribers(filters, cursorStack.cursor);

  const columns: Column<NewsletterSubscriber>[] = [
    {
      key: "email",
      header: "Email",
      render: (row) => (
        <span className="flex flex-col">
          <span className="text-fg">{row.email}</span>
          {row.suppressedReason && (
            <span className="mt-0.5 text-[10.5px] text-no">
              suppressed: {row.suppressedReason}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge tone={row.status === "subscribed" ? "yes" : "neutral"}>
          {row.status}
        </Badge>
      ),
    },
    {
      key: "source",
      header: "Source",
      render: (row) => <span className="text-[11px] text-muted">{row.source}</span>,
    },
    {
      key: "joined",
      header: "Joined",
      align: "right",
      render: (row) => (
        <span className="text-[11px] text-muted">{formatDateTime(row.confirmedAt ?? row.createdAt)}</span>
      ),
    },
    {
      key: "account",
      header: "Account",
      align: "right",
      render: (row) =>
        row.userId ? (
          <Link href={`/users/${row.userId}`} className="text-[11.5px] text-accent hover:text-fg">
            Open
          </Link>
        ) : (
          <span className="text-[11px] text-faint">—</span>
        ),
    },
  ];

  return (
    <Page>
      <PageHeader
        crumbs={[{ label: "Newsletter", href: "/newsletter" }, { label: "Subscribers" }]}
        title="Subscribers"
        description="Everyone who explicitly opted in, plus anyone who left. Suppressed addresses are never emailed."
        meta={
          summary ? (
            <>
              <span>{summary.subscribers} subscribed</span>
              <span>·</span>
              <span>{summary.unsubscribed} unsubscribed</span>
              <span>·</span>
              <span className={summary.suppressed > 0 ? "text-no" : undefined}>
                {summary.suppressed} suppressed
              </span>
            </>
          ) : null
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatCard label="Subscribed" value={summary?.subscribers ?? "—"} hint="Will receive the next issue" tone="yes" />
        <StatCard label="Unsubscribed" value={summary?.unsubscribed ?? "—"} hint="Left deliberately" />
        <StatCard
          label="Suppressed"
          value={summary?.suppressed ?? "—"}
          hint="Bounced or complained"
          tone={summary && summary.suppressed > 0 ? "warning" : "neutral"}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-faint">
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-7 rounded-[6px] border border-border-strong/60 bg-field px-2 text-[11.5px] text-fg focus:border-accent focus:outline-none"
          >
            <option value="">All</option>
            <option value="subscribed">Subscribed</option>
            <option value="unsubscribed">Unsubscribed</option>
          </select>
        </label>

        <input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search by email"
          className="h-7 w-[220px] rounded-[6px] border border-border-strong/60 bg-field px-2 text-[11.5px] text-fg placeholder:text-faint focus:border-accent focus:outline-none"
          aria-label="Search subscribers by email"
        />
      </div>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.email}
        loading={isLoading}
        emptyMessage="No subscribers match these filters."
        emptyHint="Subscribers appear here when they accept the sign-in prompt or turn the toggle on."
      />

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={cursorStack.prev}
          disabled={!cursorStack.canPrev}
          className="h-7 rounded-[6px] border border-border-strong/60 px-2.5 text-[11px] text-muted transition-colors hover:text-fg disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => {
            const next = data?.nextCursor;
            if (next) cursorStack.next(next);
          }}
          disabled={!data?.nextCursor}
          className="h-7 rounded-[6px] border border-border-strong/60 px-2.5 text-[11px] text-muted transition-colors hover:text-fg disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </Page>
  );
}
