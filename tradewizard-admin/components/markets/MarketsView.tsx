"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { DataTable, type Column } from "@/components/data/DataTable";
import { Pagination, ToggleFilter } from "@/components/data/Filters";
import { StatusPill, TimeCell } from "@/components/domain/Primitives";
import { Badge } from "@/components/ui/Badge";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { StatCard, StatGrid } from "@/components/ui/Stat";
import { useCursorStack } from "@/hooks/useCursorStack";
import { adminFetch, adminFetchPage } from "@/lib/admin-api";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { MarketScheduleRow, MarketScheduleSummary } from "@/types/admin";

const COLUMNS: Column<MarketScheduleRow>[] = [
  {
    key: "market",
    header: "Market",
    render: (row) => (
      <span
        className="block max-w-[440px] truncate text-[12px]"
        title={row.marketQuestion ?? row.marketId}
      >
        {row.marketQuestion ?? row.marketId}
      </span>
    ),
  },
  {
    key: "interval",
    header: "Interval",
    align: "right",
    render: (row) => (
      <span className="num text-[12px] text-muted">{Math.round(row.intervalSeconds / 60)}m</span>
    ),
  },
  { key: "next", header: "Next run", align: "right", render: (row) => <TimeCell value={row.nextScheduledRun} /> },
  {
    key: "last",
    header: "Last completed",
    align: "right",
    render: (row) =>
      row.lastCompletedAt ? (
        <TimeCell value={row.lastCompletedAt} />
      ) : (
        <span className="text-[11.5px] text-faint">never</span>
      ),
  },
  { key: "status", header: "Status", render: (row) => <StatusPill status={row.status} /> },
  {
    key: "executing",
    header: "Executing",
    render: (row) => (
      <Badge tone={row.stuck ? "no" : row.isExecuting ? "warning" : "neutral"} dot>
        {row.stuck ? "stuck" : row.isExecuting ? "running" : "idle"}
      </Badge>
    ),
  },
];

export function MarketsView() {
  const router = useRouter();
  const params = useSearchParams();
  const { idToken } = useAdminAuth();

  const stuckOnly = params.get("stuck") === "true";
  const stack = useCursorStack(`markets|${stuckOnly}`);

  const { data: summary } = useQuery<MarketScheduleSummary>({
    queryKey: ["admin", "markets", "summary"],
    queryFn: () => adminFetch<MarketScheduleSummary>("admin/markets/summary", { token: idToken }),
    enabled: Boolean(idToken),
    retry: false,
    staleTime: 30_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "markets", "schedule", stuckOnly, stack.cursor],
    queryFn: () => {
      const query = new URLSearchParams();
      if (stuckOnly) query.set("stuck", "true");
      if (stack.cursor) query.set("cursor", stack.cursor);
      const suffix = query.toString();
      return adminFetchPage<MarketScheduleRow>(
        suffix ? `admin/markets/schedule?${suffix}` : "admin/markets/schedule",
        { token: idToken }
      );
    },
    enabled: Boolean(idToken),
    retry: false,
  });

  return (
    <Page>
      <PageHeader
        title="Markets"
        description="The analysis pool is shared across users: one schedule per market, one execution per interval. A row that is executing with a stale start time blocks that market indefinitely."
        meta={
          <>
            <span>{formatNumber(summary?.active ?? 0)} active schedules</span>
            <span aria-hidden className="text-border-strong">·</span>
            <span>ordered by next run</span>
            <span aria-hidden className="text-border-strong">·</span>
            <span>
              last completion{" "}
              <span className="text-fg">
                {summary?.lastCompletedAt ? formatDateTime(summary.lastCompletedAt) : "never"}
              </span>
            </span>
          </>
        }
      />

      <StatGrid>
        <StatCard
          label="Scheduled markets"
          value={formatNumber(summary?.total ?? 0)}
          hint={`${formatNumber(summary?.active ?? 0)} active`}
        />
        <StatCard
          label="Executing now"
          value={formatNumber(summary?.executing ?? 0)}
          hint={`${formatNumber(summary?.dueSoon ?? 0)} due within 15m`}
        />
        <StatCard
          label="Stuck"
          value={formatNumber(summary?.stuck ?? 0)}
          tone={(summary?.stuck ?? 0) > 0 ? "no" : "neutral"}
          hint="executing for more than 15 minutes"
        />
        <StatCard
          label="Last completion"
          value={summary?.lastCompletedAt ? formatDateTime(summary.lastCompletedAt).split(",")[0] : "never"}
          hint={summary?.lastCompletedAt ? "UTC" : "no completed runs yet"}
        />
      </StatGrid>

      <div className="mb-3 mt-4 flex flex-wrap items-end justify-between gap-3">
        <ToggleFilter
          label="Stuck only"
          checked={stuckOnly}
          onChange={(checked) => {
            const next = new URLSearchParams(params.toString());
            if (checked) next.set("stuck", "true");
            else next.delete("stuck");
            next.delete("cursor");
            const query = next.toString();
            router.replace(query ? `/markets?${query}` : "/markets");
          }}
        />
        <span className="text-[11px] text-faint">
          A stuck row means the pool believes an execution is still running.
        </span>
      </div>

      <DataTable
        columns={COLUMNS}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading}
        emptyMessage={stuckOnly ? "Nothing is stuck." : "No markets have a schedule yet."}
        emptyHint={
          stuckOnly
            ? "Every executing row has finished within the 15-minute bound."
            : "Schedules are created when a market enters the analysis pool."
        }
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
