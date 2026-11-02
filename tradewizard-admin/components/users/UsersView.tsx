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
  ToggleFilter,
} from "@/components/data/Filters";
import { PlanBadge, StatusPill, TimeCell } from "@/components/domain/Primitives";
import { Notice } from "@/components/ui/Notice";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { useCursorStack } from "@/hooks/useCursorStack";
import { useUsers } from "@/hooks/useUsers";
import { formatCredits } from "@/lib/format";
import type { UserSummary } from "@/types/admin";

const PLAN_OPTIONS = [
  { value: "", label: "All plans" },
  { value: "free", label: "Free" },
  { value: "starter", label: "Starter" },
  { value: "pro", label: "Pro" },
  { value: "elite", label: "Elite" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "banned", label: "Banned" },
];

const COLUMNS: Column<UserSummary>[] = [
  {
    key: "email",
    header: "Account",
    render: (row) => (
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-fg">{row.email}</span>
        {row.displayName && (
          <span className="truncate text-[11px] text-faint">{row.displayName}</span>
        )}
      </span>
    ),
  },
  { key: "plan", header: "Plan", render: (row) => <PlanBadge plan={row.plan} /> },
  { key: "status", header: "Status", render: (row) => <StatusPill status={row.status} /> },
  {
    key: "credits",
    header: "Credits",
    align: "right",
    render: (row) => (
      <span className="num text-[12px]">
        {formatCredits(row.creditsRemaining, row.creditsMonthlyLimit)}
      </span>
    ),
  },
  {
    key: "renewal",
    header: "Renews",
    align: "right",
    render: (row) => <TimeCell value={row.billingCycleEnd} />,
  },
  {
    key: "created",
    header: "Joined",
    align: "right",
    render: (row) => <TimeCell value={row.createdAt} />,
  },
];

export function UsersView() {
  const router = useRouter();
  const params = useSearchParams();

  const q = params.get("q") ?? "";
  const plan = params.get("plan") ?? "";
  const status = params.get("status") ?? "";
  const hasPm = params.get("hasPm") === "true";

  // The input is local so typing does not refetch on every keystroke. It is
  // re-synced from the URL during render (not in an effect) so back/forward
  // navigation still updates the field without a render cascade.
  const [term, setTerm] = useState(q);
  const [syncedQ, setSyncedQ] = useState(q);

  if (q !== syncedQ) {
    setSyncedQ(q);
    setTerm(q);
  }

  function updateParams(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    next.delete("cursor");
    const query = next.toString();
    router.replace(query ? `/users?${query}` : "/users");
  }

  useEffect(() => {
    if (term === q) return;
    const timer = setTimeout(() => {
      updateParams({ q: term || null });
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, q]);

  const cursorStack = useCursorStack(`${q}|${plan}|${status}|${hasPm}`);
  const { data, isLoading, error } = useUsers({ q, plan, status, hasPm }, cursorStack.cursor);

  const filtersActive = Boolean(q || plan || status || hasPm);

  return (
    <Page>
      <PageHeader
        title="Users"
        description="Customer accounts, their plan and credit balance. Open a row for the ledger, sessions and support notes."
        meta={
          <>
            <span>{data ? `${data.items.length} shown` : "—"}</span>
            <span aria-hidden className="text-border-strong">·</span>
            <span>newest first</span>
            {hasPm && (
              <>
                <span aria-hidden className="text-border-strong">·</span>
                <span className="text-fg">portfolio managers only</span>
              </>
            )}
          </>
        }
      />

      <Toolbar
        right={
          <ClearFilters
            active={filtersActive}
            onClick={() => {
              setTerm("");
              router.replace("/users");
            }}
          />
        }
      >
        <SearchInput
          label="Search"
          value={term}
          onChange={setTerm}
          placeholder="Email or display name"
        />
        <SelectFilter
          label="Plan"
          value={plan}
          options={PLAN_OPTIONS}
          onChange={(value) => updateParams({ plan: value || null })}
        />
        <SelectFilter
          label="Status"
          value={status}
          options={STATUS_OPTIONS}
          onChange={(value) => updateParams({ status: value || null })}
        />
        <ToggleFilter
          label="Has portfolio manager"
          checked={hasPm}
          onChange={(checked) => updateParams({ hasPm: checked ? "true" : null })}
        />
      </Toolbar>

      {error ? (
        <Notice tone="error" title="Could not load users">
          {(error as Error).message}
        </Notice>
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={data?.items ?? []}
            getRowId={(row) => row.id}
            getRowHref={(row) => `/users/${row.id}`}
            loading={isLoading}
            emptyMessage="No users match these filters."
            emptyHint="Search by the exact email, or clear the plan and status filters."
          />

          <Pagination
            hasNext={Boolean(data?.nextCursor)}
            canPrev={cursorStack.canPrev}
            loading={isLoading}
            onNext={() => data?.nextCursor && cursorStack.next(data.nextCursor)}
            onPrev={cursorStack.prev}
          />
        </>
      )}
    </Page>
  );
}
