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
import { Pnl, StatusPill, TimeCell } from "@/components/domain/Primitives";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Card";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { StatCard, StatGrid } from "@/components/ui/Stat";
import { useCursorStack } from "@/hooks/useCursorStack";
import { useExposure, useSessions } from "@/hooks/usePortfolio";
import { formatNumber, formatUsdc } from "@/lib/format";
import type { PortfolioSessionRow } from "@/types/admin";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "exiting", label: "Exiting" },
  { value: "completed", label: "Completed" },
  { value: "terminated", label: "Terminated" },
];

const COLUMNS: Column<PortfolioSessionRow>[] = [
  {
    key: "user",
    header: "Account / market",
    render: (row) => (
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[12px] text-fg">{row.userEmail ?? row.userId.slice(0, 8)}</span>
        <span className="mono truncate text-[10.5px] text-faint">{row.marketId.slice(0, 18)}…</span>
      </span>
    ),
  },
  {
    key: "persona",
    header: "Persona",
    render: (row) => <Badge tone="ai">{row.personaId}</Badge>,
  },
  { key: "status", header: "Status", render: (row) => <StatusPill status={row.status} /> },
  {
    key: "invested",
    header: "Invested",
    align: "right",
    render: (row) => <span className="num text-[12px]">{formatUsdc(row.investmentAmount)}</span>,
  },
  {
    key: "atRisk",
    header: "In position",
    align: "right",
    render: (row) => (
      <span className="num text-[12px] text-muted">{formatUsdc(row.amountInPositions)}</span>
    ),
  },
  {
    key: "realized",
    header: "Realised",
    align: "right",
    render: (row) => <Pnl value={row.realizedPnl} />,
  },
  {
    key: "trades",
    header: "Wins",
    align: "right",
    render: (row) => (
      <span className="num text-[12px] text-muted">
        {row.winningTrades}/{row.totalTrades}
      </span>
    ),
  },
  {
    key: "created",
    header: "Opened",
    align: "right",
    render: (row) => <TimeCell value={row.createdAt} />,
  },
];

export function PortfolioView() {
  const router = useRouter();
  const params = useSearchParams();

  const status = params.get("status") ?? "";
  const userId = params.get("userId") ?? "";
  const marketId = params.get("marketId") ?? "";

  const [marketTerm, setMarketTerm] = useState(marketId);
  const [syncedMarket, setSyncedMarket] = useState(marketId);

  if (marketId !== syncedMarket) {
    setSyncedMarket(marketId);
    setMarketTerm(marketId);
  }

  function updateParams(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    next.delete("cursor");
    const query = next.toString();
    router.replace(query ? `/portfolio?${query}` : "/portfolio");
  }

  useEffect(() => {
    if (marketTerm === marketId) return;
    const timer = setTimeout(() => updateParams({ marketId: marketTerm || null }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketTerm]);

  const cursorStack = useCursorStack(`${status}|${userId}|${marketId}`);
  const { data, isLoading } = useSessions({ status, userId, marketId }, cursorStack.cursor);
  const { data: exposure } = useExposure();

  const totals = exposure?.totals;
  const riskFlags = (totals?.sessionsReduced ?? 0) + (totals?.sessionsNearLossLimit ?? 0);
  const personaMax = Math.max(1, ...(exposure?.byPersona.map((row) => row.capitalAtRisk) ?? [1]));

  return (
    <Page>
      <PageHeader
        title="Portfolio managers"
        description="Every autonomous session across users. Exposure counts only sessions that can still trade or hold a position."
        meta={
          <>
            <span>{data ? `${data.items.length} sessions shown` : "—"}</span>
            <span aria-hidden className="text-border-strong">·</span>
            <span>{formatNumber(totals?.users ?? 0)} users with sessions</span>
            <span aria-hidden className="text-border-strong">·</span>
            <span>{formatNumber(totals?.pendingOrders ?? 0)} pending orders</span>
          </>
        }
      />

      <StatGrid>
        <StatCard
          label="Open sessions"
          value={formatNumber(totals?.openSessions ?? 0)}
          hint={`${formatNumber(totals?.activeSessions ?? 0)} active`}
        />
        <StatCard
          label="Capital at risk"
          value={formatUsdc(totals?.capitalAtRisk ?? 0)}
          hint={`${formatUsdc(totals?.capitalAvailable ?? 0)} still available`}
        />
        <StatCard
          label="Unrealised P&L"
          value={formatUsdc(totals?.unrealizedPnl ?? 0)}
          tone={
            (totals?.unrealizedPnl ?? 0) < 0
              ? "no"
              : (totals?.unrealizedPnl ?? 0) > 0
                ? "yes"
                : "neutral"
          }
          hint="marked to current price"
        />
        <StatCard
          label="Risk flags"
          value={formatNumber(riskFlags)}
          tone={riskFlags > 0 ? "warning" : "neutral"}
          hint={`${formatNumber(totals?.sessionsNearLossLimit ?? 0)} near loss limit · ${formatNumber(totals?.sessionsReduced ?? 0)} size-reduced`}
        />
      </StatGrid>

      {exposure && exposure.byPersona.length > 0 && (
        <Panel
          title="Capital by persona"
          description="Where open exposure sits. Bars are relative to the largest persona."
          className="mt-4"
          actions={<Badge tone="neutral">{exposure.byPersona.length} personas</Badge>}
        >
          <ul className="flex flex-col gap-2">
            {exposure.byPersona.map((row) => (
              <li key={row.personaId} className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate text-[11.5px] text-muted">{row.personaId}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-[2px] bg-surface-2">
                  <span
                    className="block h-full rounded-[2px] bg-accent/70"
                    style={{
                      width: `${Math.max(2, Math.round((row.capitalAtRisk / personaMax) * 100))}%`,
                    }}
                  />
                </span>
                <span className="num w-20 text-right text-[11.5px] text-fg">
                  {formatUsdc(row.capitalAtRisk)}
                </span>
                <span className="num w-8 text-right text-[11px] text-faint">{row.sessions}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="mt-4">
        <Toolbar
          right={
            <ClearFilters
              active={Boolean(status || userId || marketId)}
              onClick={() => {
                setMarketTerm("");
                router.replace("/portfolio");
              }}
            />
          }
        >
          <SelectFilter
            label="Status"
            value={status}
            options={STATUS_OPTIONS}
            onChange={(value) => updateParams({ status: value || null })}
          />
          <SearchInput
            label="Market id"
            value={marketTerm}
            onChange={setMarketTerm}
            placeholder="0x…"
          />
          <SearchInput
            label="User id"
            value={userId}
            onChange={(value) => updateParams({ userId: value || null })}
            placeholder="uuid"
          />
        </Toolbar>

        <DataTable
          columns={COLUMNS}
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          getRowHref={(row) => `/portfolio/${row.id}`}
          loading={isLoading}
          emptyMessage="No sessions match these filters."
          emptyHint="Sessions open when a user activates a portfolio manager on a market."
        />

        <Pagination
          hasNext={Boolean(data?.nextCursor)}
          canPrev={cursorStack.canPrev}
          loading={isLoading}
          onNext={() => data?.nextCursor && cursorStack.next(data.nextCursor)}
          onPrev={cursorStack.prev}
        />
      </div>
    </Page>
  );
}
