"use client";

import { useMemo, useState } from "react";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { DataTable, type Column } from "@/components/data/DataTable";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/Stat";
import { useCursorStack } from "@/hooks/useCursorStack";
import { useAdminMe } from "@/hooks/useAdminMe";
import { useSupportSummary, useSupportTickets, type SupportFilters } from "@/hooks/useSupport";
import { formatRelative } from "@/lib/format";
import type { SupportTicketRow } from "@/types/admin";

const STATUS_TONE: Record<SupportTicketRow["status"], "accent" | "warning" | "yes" | "neutral"> = {
  open: "accent",
  pending: "warning",
  resolved: "yes",
  closed: "neutral",
};

const PRIORITY_TONE: Record<SupportTicketRow["priority"], "no" | "warning" | "neutral"> = {
  urgent: "no",
  high: "warning",
  normal: "neutral",
  low: "neutral",
};

const TOPICS = [
  { value: "", label: "All topics" },
  { value: "analysis", label: "Analysis" },
  { value: "portfolio", label: "Portfolio" },
  { value: "billing", label: "Billing" },
  { value: "login", label: "Sign-in" },
  { value: "data", label: "Data" },
  { value: "other", label: "Other" },
];

export function SupportInbox() {
  const { data: identity } = useAdminMe();
  const { data: summary } = useSupportSummary();

  const [filters, setFilters] = useState<SupportFilters>({
    status: "",
    assignee: "all",
    topic: "",
    q: "",
  });

  const resetKey = useMemo(() => JSON.stringify(filters), [filters]);
  const cursorStack = useCursorStack(resetKey);
  const { data, isLoading } = useSupportTickets(filters, cursorStack.cursor);

  const columns: Column<SupportTicketRow>[] = [
    {
      key: "ref",
      header: "Ref",
      className: "w-[110px]",
      render: (row) => <span className="mono text-[11.5px] text-fg">{row.ref}</span>,
    },
    {
      key: "subject",
      header: "Request",
      render: (row) => (
        <span className="block max-w-[380px]">
          <span className="block truncate text-fg">{row.subject}</span>
          <span className="mt-0.5 block text-[10.5px] text-faint">
            {row.topic}
            {row.marketId ? ` · ${row.marketId.slice(0, 10)}…` : ""}
          </span>
        </span>
      ),
    },
    {
      key: "requester",
      header: "Requester",
      render: (row) => <span className="text-[11.5px] text-muted">{row.requesterEmail}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <span className="flex items-center gap-1.5">
          <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>
          {row.overdue && <Badge tone="no">overdue</Badge>}
        </span>
      ),
    },
    {
      key: "priority",
      header: "Priority",
      render: (row) =>
        row.priority === "normal" ? (
          <span className="text-[11px] text-faint">normal</span>
        ) : (
          <Badge tone={PRIORITY_TONE[row.priority]}>{row.priority}</Badge>
        ),
    },
    {
      key: "assignee",
      header: "Assignee",
      render: (row) =>
        row.assignedAdminSub ? (
          <span className="text-[11.5px] text-fg">
            {row.assignedAdminSub === identity?.sub
              ? "You"
              : `${row.assignedAdminSub.slice(0, 8)}…`}
          </span>
        ) : (
          <span className="text-[11px] text-faint">Unassigned</span>
        ),
    },
    {
      key: "activity",
      header: "Activity",
      align: "right",
      render: (row) => (
        <span className="text-[11px] text-muted">{formatRelative(row.lastMessageAt)}</span>
      ),
    },
  ];

  return (
    <Page>
      <PageHeader
        title="Support"
        description="Customer requests from the product. Claim one before replying — two answers to one ticket is worse than a slow one."
        meta={
          summary ? (
            <>
              <span>{summary.open} open</span>
              <span>·</span>
              <span>{summary.pending} waiting on customer</span>
              <span>·</span>
              <span>{summary.unassigned} unassigned</span>
              <span>·</span>
              <span className={summary.overdue > 0 ? "text-no" : undefined}>
                {summary.overdue} overdue (target {summary.slaHours}h)
              </span>
            </>
          ) : null
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="Open" value={summary?.open ?? "—"} hint="Awaiting first reply" />
        <StatCard
          label="Unassigned"
          value={summary?.unassigned ?? "—"}
          hint="Nobody holds these"
          tone={summary && summary.unassigned > 0 ? "warning" : "neutral"}
        />
        <StatCard
          label="Overdue"
          value={summary?.overdue ?? "—"}
          hint={`No reply within ${summary?.slaHours ?? 24}h`}
          tone={summary && summary.overdue > 0 ? "no" : "neutral"}
        />
        <StatCard
          label="Waiting on customer"
          value={summary?.pending ?? "—"}
          hint="Replied, not resolved"
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          label="Status"
          value={filters.status}
          onChange={(value) => setFilters((current) => ({ ...current, status: value }))}
          options={[
            { value: "", label: "All statuses" },
            { value: "open", label: "Open" },
            { value: "pending", label: "Waiting on customer" },
            { value: "resolved", label: "Resolved" },
            { value: "closed", label: "Closed" },
          ]}
        />

        <Select
          label="Assignee"
          value={filters.assignee}
          onChange={(value) =>
            setFilters((current) => ({
              ...current,
              assignee: value as SupportFilters["assignee"],
            }))
          }
          options={[
            { value: "all", label: "Anyone" },
            { value: "me", label: "Mine" },
            { value: "unassigned", label: "Unassigned" },
          ]}
        />

        <Select
          label="Topic"
          value={filters.topic}
          onChange={(value) => setFilters((current) => ({ ...current, topic: value }))}
          options={TOPICS}
        />

        <span className="ml-auto text-[11px] text-faint">
          {data ? `${data.items.length} shown` : ""}
        </span>
      </div>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        getRowHref={(row) => `/support/${row.id}`}
        loading={isLoading}
        emptyMessage="No tickets match these filters."
        emptyHint="Customers reach this inbox from the product: verdict, portfolio sessions, or /help."
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

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-faint">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 rounded-[6px] border border-border-strong/60 bg-field px-2 text-[11.5px] text-fg focus:border-accent focus:outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
