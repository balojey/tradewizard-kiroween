"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import { DataTable, type Column } from "@/components/data/DataTable";
import {
  ClearFilters,
  DateFilter,
  Pagination,
  SearchInput,
  SelectFilter,
  Toolbar,
} from "@/components/data/Filters";
import { StatusPill, TimeCell } from "@/components/domain/Primitives";
import { QualityPanel } from "@/components/analyses/QualityPanel";
import { Notice } from "@/components/ui/Notice";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { Tabs } from "@/components/ui/Tabs";
import { useCursorStack } from "@/hooks/useCursorStack";
import { useAnalyses, type AnalysisFilters } from "@/hooks/useAnalyses";
import { formatNumber } from "@/lib/format";
import type { ExecutionRow } from "@/types/admin";

const RECOMMENDATIONS = [
  { value: "", label: "All calls" },
  { value: "LONG_YES", label: "LONG_YES" },
  { value: "LONG_NO", label: "LONG_NO" },
  { value: "NO_TRADE", label: "NO_TRADE" },
];

const OUTCOMES = [
  { value: "", label: "All outcomes" },
  { value: "pending", label: "Pending" },
  { value: "success", label: "Success" },
  { value: "failure", label: "Failure" },
  { value: "expired", label: "Expired" },
  { value: "no_trade", label: "No trade" },
];

const COLUMNS: Column<ExecutionRow>[] = [
  { key: "executed", header: "Executed", render: (row) => <TimeCell value={row.executedAt} /> },
  {
    key: "market",
    header: "Market",
    render: (row) => (
      <span
        className="block max-w-[380px] truncate text-[12px]"
        title={row.marketQuestion ?? row.marketId}
      >
        {row.marketQuestion ?? row.marketId}
      </span>
    ),
  },
  { key: "call", header: "Call", render: (row) => <StatusPill status={row.recommendation} /> },
  {
    key: "fair",
    header: "Fair",
    align: "right",
    render: (row) => (
      <span className="num text-[12px]">
        {row.consensusProbability === null
          ? "—"
          : `${Math.round(row.consensusProbability * 100)}%`}
      </span>
    ),
  },
  {
    key: "confidence",
    header: "Conf.",
    align: "right",
    render: (row) => (
      <span className="num text-[12px] text-muted">
        {row.confidence === null ? "—" : `${Math.round(row.confidence * 100)}%`}
      </span>
    ),
  },
  {
    key: "edge",
    header: "Edge",
    align: "right",
    render: (row) => (
      <span
        className={`num text-[12px] ${
          row.edge === null ? "text-faint" : row.edge > 0 ? "text-yes" : "text-no"
        }`}
      >
        {row.edge === null ? "—" : `${row.edge > 0 ? "+" : ""}${(row.edge * 100).toFixed(1)}`}
      </span>
    ),
  },
  { key: "outcome", header: "Outcome", render: (row) => <StatusPill status={row.outcomeStatus} /> },
  {
    key: "cost",
    header: "Cost",
    align: "right",
    render: (row) => (
      <span className="num text-[11.5px] text-muted">
        {row.modelCostsUsd === null ? "—" : `$${row.modelCostsUsd.toFixed(3)}`}
      </span>
    ),
  },
  {
    key: "duration",
    header: "Time",
    align: "right",
    render: (row) => (
      <span className="num text-[11.5px] text-muted">
        {row.executionDurationMs === null ? "—" : `${Math.round(row.executionDurationMs / 1000)}s`}
      </span>
    ),
  },
];

export function AnalysesView() {
  const router = useRouter();
  const params = useSearchParams();

  const view = params.get("view") === "quality" ? "quality" : "executions";
  const windowDays = Number(params.get("days") ?? 7);

  const filters: AnalysisFilters = {
    marketId: params.get("marketId") ?? "",
    recommendation: params.get("recommendation") ?? "",
    outcome: params.get("outcome") ?? "",
    noTradeReason: params.get("noTradeReason") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
  };

  const [marketTerm, setMarketTerm] = useState(filters.marketId);
  const [syncedMarket, setSyncedMarket] = useState(filters.marketId);

  if (filters.marketId !== syncedMarket) {
    setSyncedMarket(filters.marketId);
    setMarketTerm(filters.marketId);
  }

  function updateParams(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    next.delete("cursor");
    const query = next.toString();
    router.replace(query ? `/analyses?${query}` : "/analyses");
  }

  useEffect(() => {
    if (marketTerm === filters.marketId) return;
    const timer = setTimeout(() => updateParams({ marketId: marketTerm || null }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketTerm]);

  const cursorStack = useCursorStack(JSON.stringify(filters));
  const { data, isLoading, error } = useAnalyses(filters, cursorStack.cursor);

  const filtersActive = Boolean(
    filters.marketId || filters.recommendation || filters.outcome || filters.from || filters.to
  );

  return (
    <Page>
      <PageHeader
        title="Analyses"
        description="Every execution in the market-level pool, and how the live decision compares to the shadow configuration."
        meta={
          view === "executions" ? (
            <>
              <span>{data ? `${data.items.length} rows` : "—"}</span>
              <span aria-hidden className="text-border-strong">·</span>
              <span>newest first</span>
            </>
          ) : (
            <>
              <span>window {formatNumber(windowDays)} days</span>
              <span aria-hidden className="text-border-strong">·</span>
              <span>quality aggregates run over the execution table</span>
            </>
          )
        }
      />

      <Tabs
        className="mb-4"
        value={view}
        onChange={(key) => updateParams({ view: key === "executions" ? null : key })}
        items={[
          { key: "executions", label: "Executions" },
          { key: "quality", label: "Quality" },
        ]}
      />

      {view === "quality" ? (
        <QualityPanel
          windowDays={windowDays}
          onWindowChange={(days) => updateParams({ days: String(days) })}
        />
      ) : (
        <>
          <Toolbar
            right={
              <ClearFilters
                active={filtersActive}
                onClick={() => {
                  setMarketTerm("");
                  router.replace("/analyses");
                }}
              />
            }
          >
            <SearchInput
              label="Market id"
              value={marketTerm}
              onChange={setMarketTerm}
              placeholder="0x…"
            />
            <SelectFilter
              label="Call"
              value={filters.recommendation}
              options={RECOMMENDATIONS}
              onChange={(value) => updateParams({ recommendation: value || null })}
            />
            <SelectFilter
              label="Outcome"
              value={filters.outcome}
              options={OUTCOMES}
              onChange={(value) => updateParams({ outcome: value || null })}
            />
            <DateFilter
              label="From"
              value={filters.from}
              onChange={(value) => updateParams({ from: value || null })}
            />
            <DateFilter
              label="To"
              value={filters.to}
              onChange={(value) => updateParams({ to: value || null })}
            />
          </Toolbar>

          {error ? (
            <Notice tone="error" title="Could not load executions">
              {(error as Error).message}
            </Notice>
          ) : (
            <>
              <DataTable
                columns={COLUMNS}
                rows={data?.items ?? []}
                getRowId={(row) => row.id}
                getRowHref={(row) => `/analyses/${row.id}`}
                loading={isLoading}
                emptyMessage="No executions match these filters."
                emptyHint="Widen the date range or clear the call and outcome filters."
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
        </>
      )}
    </Page>
  );
}
