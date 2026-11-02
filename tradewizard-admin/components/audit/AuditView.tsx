"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DataTable, type Column } from "@/components/data/DataTable";
import {
  ClearFilters,
  Pagination,
  SearchInput,
  SelectFilter,
  Toolbar,
} from "@/components/data/Filters";
import { Badge } from "@/components/ui/Badge";
import { CopyableId, TimeCell } from "@/components/domain/Primitives";
import { Notice } from "@/components/ui/Notice";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { useAudit } from "@/hooks/useAudit";
import { useCursorStack } from "@/hooks/useCursorStack";
import type { AuditEntry } from "@/types/admin";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "pending", label: "Pending" },
];

function Summary({ entry }: { entry: AuditEntry }) {
  const payload = (entry.after ?? entry.before) as Record<string, unknown> | null;
  if (!payload) return <span className="text-faint">—</span>;

  const text = Object.entries(payload)
    .map(([key, value]) => `${key}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
    .join(" · ");

  return (
    <span className="mono block max-w-[340px] truncate text-[10.5px] text-faint" title={text}>
      {text}
    </span>
  );
}

const COLUMNS: Column<AuditEntry>[] = [
  { key: "when", header: "When", render: (row) => <TimeCell value={row.createdAt} /> },
  {
    key: "action",
    header: "Action",
    render: (row) => <span className="mono text-[11px] text-fg">{row.action}</span>,
  },
  {
    key: "actor",
    header: "Actor",
    render: (row) => (
      <span className="flex flex-col">
        <span className="truncate text-[11.5px]">{row.actorEmail}</span>
        <span className="text-[10px] uppercase tracking-[0.07em] text-faint">{row.actorRole}</span>
      </span>
    ),
  },
  {
    key: "target",
    header: "Target",
    render: (row) => (
      <span className="flex flex-col gap-0.5">
        <span className="text-[10.5px] uppercase tracking-[0.05em] text-faint">{row.targetType}</span>
        <CopyableId value={row.targetId} label="target id" chars={8} />
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (row) => (
      <Badge
        dot
        tone={row.status === "succeeded" ? "yes" : row.status === "failed" ? "no" : "warning"}
      >
        {row.status}
      </Badge>
    ),
  },
  {
    key: "reason",
    header: "Reason",
    render: (row) => (
      <span className="block max-w-[220px] truncate text-[11px] text-muted" title={row.reason}>
        {row.reason}
      </span>
    ),
  },
  { key: "detail", header: "Detail", render: (row) => <Summary entry={row} /> },
];

export function AuditView() {
  const router = useRouter();
  const params = useSearchParams();

  const filters = {
    actor: params.get("actor") ?? "",
    action: params.get("action") ?? "",
    targetType: params.get("targetType") ?? "",
    targetId: params.get("targetId") ?? "",
    status: params.get("status") ?? "",
  };

  const [actorTerm, setActorTerm] = useState(filters.actor);
  const [actionTerm, setActionTerm] = useState(filters.action);
  const [syncedActor, setSyncedActor] = useState(filters.actor);
  const [syncedAction, setSyncedAction] = useState(filters.action);

  if (filters.actor !== syncedActor) {
    setSyncedActor(filters.actor);
    setActorTerm(filters.actor);
  }
  if (filters.action !== syncedAction) {
    setSyncedAction(filters.action);
    setActionTerm(filters.action);
  }

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    next.delete("cursor");
    const query = next.toString();
    router.replace(query ? `/audit?${query}` : "/audit");
  }

  useEffect(() => {
    if (actorTerm === filters.actor) return;
    const timer = setTimeout(() => update({ actor: actorTerm || null }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorTerm]);

  useEffect(() => {
    if (actionTerm === filters.action) return;
    const timer = setTimeout(() => update({ action: actionTerm || null }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionTerm]);

  const stack = useCursorStack(JSON.stringify(filters));
  const { data, isLoading, error } = useAudit(filters, stack.cursor);

  const filtersActive = Boolean(
    filters.actor || filters.action || filters.targetType || filters.targetId || filters.status
  );

  return (
    <Page>
      <PageHeader
        title="Audit"
        description="Append-only record of every admin action. Rows cannot be edited or deleted — the database rejects both."
        meta={
          <>
            <span>{data ? `${data.items.length} entries` : "—"}</span>
            <span aria-hidden className="text-border-strong">·</span>
            <span>newest first</span>
            <span aria-hidden className="text-border-strong">·</span>
            <span>written before the response is sent</span>
          </>
        }
      />

      <Toolbar
        right={
          <ClearFilters
            active={filtersActive}
            onClick={() => {
              setActorTerm("");
              setActionTerm("");
              router.replace("/audit");
            }}
          />
        }
      >
        <SearchInput label="Actor" value={actorTerm} onChange={setActorTerm} placeholder="Email or sub" />
        <SearchInput
          label="Action"
          value={actionTerm}
          onChange={setActionTerm}
          placeholder="user.note.create"
        />
        <SelectFilter
          label="Status"
          value={filters.status}
          options={STATUS_OPTIONS}
          onChange={(value) => update({ status: value || null })}
        />
      </Toolbar>

      {error && (
        <Notice tone="error" title="Could not load the audit log" className="mb-3">
          {(error as Error).message}
        </Notice>
      )}

      <DataTable
        columns={COLUMNS}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading}
        emptyMessage="No audit entries match these filters."
        emptyHint="Try a shorter action prefix, or clear the status filter."
      />

      <Pagination
        hasNext={Boolean(data?.nextCursor)}
        canPrev={stack.canPrev}
        loading={isLoading}
        onNext={() => data?.nextCursor && stack.next(data.nextCursor)}
        onPrev={stack.prev}
      />
    </Page>
  );
}
