"use client";

import Link from "next/link";
import { Dialog } from "@/components/ui/Dialog";
import { Notice } from "@/components/ui/Notice";
import { Badge } from "@/components/ui/Badge";
import { KeyValue, StatusPill } from "@/components/domain/Primitives";
import { useAnalysis } from "@/hooks/useAnalyses";
import { formatDateTime, formatNumber, formatUsdc } from "@/lib/format";

function pct(value: number | null, digits = 0): string {
  return value === null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

/**
 * Analysis snapshot opened from a support ticket.
 *
 * Deliberately a dialog rather than a navigation: the operator is reading a
 * customer's complaint and should not lose the thread to check the verdict. The
 * full record is one click away for anything that needs it (refund, cache
 * invalidation, payload).
 */
export function SupportAnalysisDialog({
  analysisId,
  open,
  onClose,
}: {
  analysisId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { data: analysis, isLoading, error } = useAnalysis(open ? analysisId : "");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Analysis"
      size="lg"
      description={
        <span className="mono text-[11px] text-faint">{analysisId}</span>
      }
      footer={
        <>
          <Link
            href={`/analyses/${analysisId}`}
            className="text-[11.5px] text-accent transition-colors hover:text-fg"
          >
            Open the full record
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="h-7 rounded-[6px] bg-accent px-2.5 text-[11px] font-medium text-white transition-[filter] hover:brightness-110"
          >
            Close
          </button>
        </>
      }
    >
      {isLoading && (
        <div className="flex flex-col gap-2" aria-hidden>
          <div className="h-3 w-1/3 animate-pulse rounded bg-surface-2" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-surface-2" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-surface-2" />
        </div>
      )}

      {error && (
        <Notice tone="error" title="Could not load this analysis">
          {(error as Error).message}. It may have been pruned; the ticket itself is
          unaffected.
        </Notice>
      )}

      {analysis && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[10.5px] uppercase tracking-[0.07em] text-faint">
              Decision
            </p>
            <KeyValue label="Recommendation">
              <StatusPill status={analysis.recommendation} />
            </KeyValue>
            <KeyValue label="Fair probability">
              <span className="num">{pct(analysis.consensusProbability)}</span>
            </KeyValue>
            <KeyValue label="Market probability">
              <span className="num">{pct(analysis.marketProbability)}</span>
            </KeyValue>
            <KeyValue label="Edge">
              <span
                className={
                  analysis.edge === null
                    ? "text-faint"
                    : analysis.edge > 0
                      ? "num text-yes"
                      : "num text-no"
                }
              >
                {analysis.edge === null ? "—" : `${(analysis.edge * 100).toFixed(1)}%`}
              </span>
            </KeyValue>
            <KeyValue label="Confidence">
              <span className="num">{pct(analysis.confidence)}</span>
            </KeyValue>
            <KeyValue label="No-trade reason">
              {analysis.noTradeReason ? analysis.noTradeReason.replace(/_/g, " ") : "—"}
            </KeyValue>
          </div>

          <div>
            <p className="mb-1.5 text-[10.5px] uppercase tracking-[0.07em] text-faint">
              Execution
            </p>
            <KeyValue label="Executed">{formatDateTime(analysis.executedAt)}</KeyValue>
            <KeyValue label="Duration">
              {analysis.executionDurationMs
                ? `${Math.round(analysis.executionDurationMs / 1000)}s`
                : "—"}
            </KeyValue>
            <KeyValue label="LLM calls">{formatNumber(analysis.totalLlmCalls)}</KeyValue>
            <KeyValue label="Model cost">{formatUsdc(analysis.modelCostsUsd)}</KeyValue>
            <KeyValue label="Outcome">
              {analysis.outcomeStatus ? (
                <Badge tone={analysis.outcomeStatus === "success" ? "yes" : "neutral"}>
                  {analysis.outcomeStatus}
                </Badge>
              ) : (
                "—"
              )}
            </KeyValue>
            <KeyValue label="Market">
              <span className="block max-w-[220px] truncate" title={analysis.marketQuestion ?? analysis.marketId}>
                {analysis.marketQuestion ?? analysis.marketId}
              </span>
            </KeyValue>
          </div>
        </div>
      )}
    </Dialog>
  );
}
