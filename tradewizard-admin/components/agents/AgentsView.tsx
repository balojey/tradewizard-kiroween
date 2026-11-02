"use client";

import { useState } from "react";
import { DataTable, type Column } from "@/components/data/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Card";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { StatCard, StatGrid } from "@/components/ui/Stat";
import { Segmented } from "@/components/ui/Tabs";
import { useAgentCost, useAgentPerformance } from "@/hooks/useBillingAgents";
import { formatDateTime, formatNumber, formatUsdc } from "@/lib/format";
import type { AgentPerformanceRow } from "@/types/admin";

const WINDOWS = [7, 30, 90] as const;

function brierTone(score: number | null): "yes" | "warning" | "no" | "neutral" {
  if (score === null) return "neutral";
  if (score <= 0.15) return "yes";
  if (score <= 0.3) return "warning";
  return "no";
}

const COLUMNS: Column<AgentPerformanceRow>[] = [
  {
    key: "agent",
    header: "Agent",
    render: (row) => (
      <span className="text-[12px] text-fg">{row.agentName.replace(/_/g, " ")}</span>
    ),
  },
  {
    key: "signals",
    header: "Signals",
    align: "right",
    render: (row) => <span className="num text-[12px]">{formatNumber(row.totalSignals)}</span>,
  },
  {
    key: "correct",
    header: "Correct",
    align: "right",
    render: (row) => (
      <span className="num text-[12px] text-muted">{formatNumber(row.correctSignals)}</span>
    ),
  },
  {
    key: "accuracy",
    header: "Accuracy",
    align: "right",
    render: (row) => (
      <span
        className={`num text-[12px] ${
          row.accuracyPct >= 55 ? "text-yes" : row.accuracyPct < 45 ? "text-no" : "text-fg"
        }`}
      >
        {row.accuracyPct.toFixed(1)}%
      </span>
    ),
  },
  {
    key: "confidence",
    header: "Avg conf.",
    align: "right",
    render: (row) => (
      <span className="num text-[12px] text-muted">{(row.avgConfidence * 100).toFixed(0)}%</span>
    ),
  },
  {
    key: "brier",
    header: "Brier",
    align: "right",
    render: (row) => (
      <Badge tone={brierTone(row.brierScore)}>
        {row.brierScore === null ? "—" : row.brierScore.toFixed(4)}
      </Badge>
    ),
  },
  {
    key: "logloss",
    header: "Log loss",
    align: "right",
    render: (row) => (
      <span className="num text-[12px] text-muted">
        {row.logLoss === null ? "—" : row.logLoss.toFixed(4)}
      </span>
    ),
  },
  {
    key: "samples",
    header: "Samples",
    align: "right",
    render: (row) => (
      <span className="num text-[12px] text-muted">{formatNumber(row.calibrationSamples)}</span>
    ),
  },
  {
    key: "updated",
    header: "Updated",
    align: "right",
    render: (row) => (
      <span className="whitespace-nowrap text-[11px] text-faint">
        {formatDateTime(row.lastUpdatedAt)}
      </span>
    ),
  },
];

export function AgentsView() {
  const [windowDays, setWindowDays] = useState(7);
  const { data: performance, isLoading } = useAgentPerformance();
  const { data: cost } = useAgentCost(windowDays);

  const rows = performance ?? [];
  const calibrated = rows.filter((row) => row.calibrationSamples > 0);

  return (
    <Page>
      <PageHeader
        title="Agents"
        description="Calibration is judged against realised direction. Brier and log loss are lower-is-better; accuracy alone can hide overconfidence."
        actions={
          <Segmented
            label="Cost window"
            value={windowDays}
            onChange={setWindowDays}
            items={WINDOWS.map((days) => ({ value: days, label: `${days}d` }))}
          />
        }
        meta={
          <>
            <span>{rows.length} tracked agents</span>
            <span aria-hidden className="text-border-strong">·</span>
            <span>{calibrated.length} with scored samples</span>
            <span aria-hidden className="text-border-strong">·</span>
            <span>cost window {windowDays} days</span>
          </>
        }
      />

      <StatGrid>
        <StatCard
          label="Executions"
          value={formatNumber(cost?.totals.executions ?? 0)}
          hint={`${formatNumber(cost?.totals.markets ?? 0)} markets`}
        />
        <StatCard
          label="Model cost"
          value={formatUsdc(cost?.totals.totalCostUsd ?? 0)}
          hint={
            cost?.totals.avgCostUsd ? `${formatUsdc(cost.totals.avgCostUsd)} per run` : "no runs yet"
          }
        />
        <StatCard
          label="LLM calls"
          value={cost?.totals.avgLlmCalls ? cost.totals.avgLlmCalls.toFixed(0) : "—"}
          hint="average per run"
        />
        <StatCard
          label="Calibrated agents"
          value={`${calibrated.length}/${rows.length}`}
          hint="at least one scored sample"
          tone={rows.length > 0 && calibrated.length < rows.length ? "warning" : "neutral"}
        />
      </StatGrid>

      <div className="mt-4">
        <DataTable
          columns={COLUMNS}
          rows={rows}
          getRowId={(row) => row.agentName}
          loading={isLoading}
          emptyMessage="No agent performance recorded yet."
          emptyHint="Rows appear after the first scored analysis."
        />
      </div>

      <Panel
        title="Cost by market"
        description="Only markets with executions in the selected window."
        className="mt-4"
        bodyClassName="px-0 py-0"
        actions={<Badge tone="neutral">{cost?.byMarket.length ?? 0} markets</Badge>}
      >
        {cost?.byMarket.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <th className="micro border-b border-border px-4 py-2 text-left">Market</th>
                  <th className="micro border-b border-border px-4 py-2 text-right">Runs</th>
                  <th className="micro border-b border-border px-4 py-2 text-right">Cost</th>
                  <th className="micro border-b border-border px-4 py-2 text-right">Avg duration</th>
                </tr>
              </thead>
              <tbody>
                {cost.byMarket.map((row) => (
                  <tr
                    key={row.marketId}
                    className="border-b border-border-soft transition-colors last:border-0 hover:bg-hover/50"
                  >
                    <td
                      className="max-w-[460px] truncate px-4 py-2 text-[12px]"
                      title={row.marketQuestion ?? row.marketId}
                    >
                      {row.marketQuestion ?? row.marketId}
                    </td>
                    <td className="num px-4 py-2 text-right text-[12px]">{row.executions}</td>
                    <td className="num px-4 py-2 text-right text-[12px]">{formatUsdc(row.costUsd)}</td>
                    <td className="num px-4 py-2 text-right text-[12px] text-muted">
                      {row.avgDurationMs ? `${Math.round(row.avgDurationMs / 1000)}s` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-4 py-6 text-center text-[11.5px] text-faint">No executions in this window.</p>
        )}
      </Panel>
    </Page>
  );
}
