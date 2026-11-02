"use client";

import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { Segmented } from "@/components/ui/Tabs";
import { StatCard, StatGrid } from "@/components/ui/Stat";
import { useQuality } from "@/hooks/useAnalyses";
import { formatNumber, formatUsdc } from "@/lib/format";
import type { QualityBucket, QualityReport } from "@/types/admin";

function BarList({
  title,
  description,
  rows,
  labelOf,
  emptyMessage,
}: {
  title: string;
  description?: string;
  rows: QualityBucket[];
  labelOf: (row: QualityBucket) => string;
  emptyMessage: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.count));

  return (
    <Panel title={title} description={description}>
      {rows.length === 0 && <p className="py-2 text-[11.5px] text-faint">{emptyMessage}</p>}

      <ul className="flex flex-col gap-1.5">
        {rows.map((row, index) => (
          <li key={`${labelOf(row)}-${index}`} className="flex items-center gap-3">
            <span
              className="w-28 shrink-0 truncate text-[11.5px] text-muted"
              title={labelOf(row)}
            >
              {labelOf(row)}
            </span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-[2px] bg-surface-2">
              <span
                className="block h-full rounded-[2px] bg-accent/70"
                style={{ width: `${Math.max(2, Math.round((row.count / max) * 100))}%` }}
              />
            </span>
            <span className="num w-10 text-right text-[11.5px] text-fg">{row.count}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function QualityPanel({
  windowDays,
  onWindowChange,
}: {
  windowDays: number;
  onWindowChange: (days: number) => void;
}) {
  const { data, isLoading, error } = useQuality(windowDays);

  const report: QualityReport | undefined = data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11.5px] text-muted">
          Aggregates are bounded to 90 days; the portal never runs an unbounded scan of the
          analysis table.
        </p>
        <Segmented
          label="Window"
          value={windowDays}
          onChange={onWindowChange}
          items={[7, 30, 90].map((days) => ({ value: days, label: `${days}d` }))}
        />
      </div>

      {error && (
        <Notice tone="error" title="Could not load quality aggregates">
          {(error as Error).message}
        </Notice>
      )}

      {isLoading && !report && <p className="text-[11.5px] text-muted">Loading aggregates…</p>}

      {report && (
        <>
          <StatGrid>
            <StatCard
              label="Executions"
              value={formatNumber(report.totals.executions)}
              hint={`${formatNumber(report.totals.markets)} markets`}
            />
            <StatCard
              label="Avg duration"
              value={
                report.totals.avgDurationMs
                  ? `${Math.round(report.totals.avgDurationMs / 1000)}s`
                  : "—"
              }
              hint="end to end per analysis"
            />
            <StatCard
              label="Avg edge"
              value={
                report.totals.avgEdge === null
                  ? "—"
                  : `${(report.totals.avgEdge * 100).toFixed(1)}%`
              }
              hint="across trades taken"
            />
            <StatCard
              label="Model cost"
              value={
                report.totals.totalCostUsd === null
                  ? "—"
                  : formatUsdc(report.totals.totalCostUsd)
              }
              hint="all providers, this window"
            />
          </StatGrid>

          <div className="grid gap-4 lg:grid-cols-2">
            <BarList
              title="Recommendations"
              description="What the consensus produced."
              rows={report.recommendations.map((row) => ({ ...row, label: row.label ?? "NONE" }))}
              labelOf={(row) => row.label ?? "—"}
              emptyMessage="No executions in this window."
            />
            <BarList
              title="No-trade reasons"
              description="Why the system stood down."
              rows={report.noTradeReasons}
              labelOf={(row) => (row.reason ?? "—").replace(/_/g, " ")}
              emptyMessage="No no-trade decisions in this window."
            />
            <BarList
              title="Edge distribution"
              description="Distance between fair value and market price."
              rows={report.edgeBuckets}
              labelOf={(row) => row.bucket ?? "—"}
              emptyMessage="No edges recorded."
            />
            <BarList
              title="Outcomes"
              description="Scored once the horizon closes."
              rows={report.outcomes}
              labelOf={(row) => (row.status ?? "—").replace(/_/g, " ")}
              emptyMessage="Nothing scored yet."
            />
          </div>

          <Panel
            title="Live vs shadow"
            description="Same markets, two consensus configurations. Shadow rows are scored on a fixed horizon so the two stay comparable."
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <div className="micro">Agreement</div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="num text-[18px] text-fg">
                    {report.shadow.withShadow > 0
                      ? `${Math.round((report.shadow.agree / report.shadow.withShadow) * 100)}%`
                      : "—"}
                  </span>
                  <Badge tone="neutral">
                    {report.shadow.agree}/{report.shadow.withShadow}
                  </Badge>
                </div>
              </div>

              <div>
                <div className="micro">Avg live P&amp;L</div>
                <div className="num mt-1 text-[18px] text-fg">
                  {report.shadow.avgLivePnl === null ? "—" : report.shadow.avgLivePnl.toFixed(4)}
                </div>
              </div>

              <div>
                <div className="micro">Avg shadow P&amp;L</div>
                <div className="num mt-1 text-[18px] text-fg">
                  {report.shadow.avgShadowPnl === null
                    ? "—"
                    : report.shadow.avgShadowPnl.toFixed(4)}
                </div>
              </div>
            </div>

            <p className="mt-3 border-t border-border-soft pt-3 text-[11px] leading-relaxed text-faint">
              A switch should only be considered on a meaningful sample, not a single window.
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}
