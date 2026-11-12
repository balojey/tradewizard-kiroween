"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Card";
import { CopilotPanel } from "@/components/copilot/CopilotPanel";
import { CopyableId, KeyValue, StatusPill } from "@/components/domain/Primitives";
import { InvalidateCacheButton } from "@/components/analyses/InvalidateCacheButton";
import { RefundButton } from "@/components/analyses/RefundButton";
import { PayloadViewer } from "@/components/analyses/PayloadViewer";
import { Notice } from "@/components/ui/Notice";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { useAdminMe } from "@/hooks/useAdminMe";
import { useAnalysis } from "@/hooks/useAnalyses";
import { formatDateTime, formatNumber, formatUsdc } from "@/lib/format";

function pct(value: number | null, digits = 0): string {
  return value === null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

export function AnalysisDetailView() {
  const routeParams = useParams<{ id: string }>();
  const analysisId = Array.isArray(routeParams.id) ? routeParams.id[0] : routeParams.id;
  const { data: analysis, isLoading, error } = useAnalysis(analysisId);
  const { data: identity } = useAdminMe();

  if (error) {
    return (
      <Page>
        <Notice
          tone="error"
          title="Could not load this analysis"
          action={
            <Link href="/analyses" className="text-[11.5px] text-accent hover:underline">
              Back to analyses
            </Link>
          }
        >
          {(error as Error).message}
        </Notice>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        crumbs={[
          { label: "Analyses", href: "/analyses" },
          { label: analysisId.slice(0, 8) + "…" },
        ]}
        title={isLoading ? "Loading execution…" : (analysis?.marketQuestion ?? analysis?.marketId ?? "Execution")}
        actions={
          analysis && (
            <>
              <InvalidateCacheButton analysisId={analysis.id} identity={identity} />
              <RefundButton analysisId={analysis.id} identity={identity} />
            </>
          )
        }
        meta={
          analysis && (
            <>
              <StatusPill status={analysis.recommendation} />
              <StatusPill status={analysis.outcomeStatus} />
              <span aria-hidden className="text-border-strong">·</span>
              <span className="flex items-center gap-1">
                <span className="text-faint">result</span>
                <CopyableId value={analysis.id} label="result id" chars={8} />
              </span>
              <span className="flex items-center gap-1">
                <span className="text-faint">market</span>
                <CopyableId value={analysis.marketId} label="market id" chars={8} />
              </span>
            </>
          )
        }
      />

      {analysis && (
        <div className="mb-4">
          <CopilotPanel
            kind="analysis"
            title="Ask Warden"
            description="Explains the verdict from the recorded agent signals, debate, and consensus. It does not re-run the analysis."
            context={{ analysisId: analysis.id }}
            placeholder="e.g. Which agents dissented?"
            prompts={[
              {
                label: "Explain this verdict",
                question:
                  "Explain this verdict. Which agents drove it, what did the debate conclude, and how did live and shadow consensus differ?",
              },
              {
                label: "Why NO_TRADE?",
                question:
                  "Why was this a NO_TRADE? Name the dissenting agents, the no-trade reason, and the gate that produced it.",
              },
            ]}
          />
        </div>
      )}

      {analysis && (
        <div className="grid gap-4 md:grid-cols-2">
          <Panel title="Decision" description="What the live consensus produced.">
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
          </Panel>

          <Panel title="Execution">
            <KeyValue label="Executed">{formatDateTime(analysis.executedAt)}</KeyValue>
            <KeyValue label="Duration">
              {analysis.executionDurationMs
                ? `${Math.round(analysis.executionDurationMs / 1000)}s`
                : "—"}
            </KeyValue>
            <KeyValue label="LLM calls">
              <span className="num">{formatNumber(analysis.totalLlmCalls)}</span>
            </KeyValue>
            <KeyValue label="Model cost">
              <span className="num">{formatUsdc(analysis.modelCostsUsd)}</span>
            </KeyValue>
            <KeyValue label="Market id">
              <CopyableId value={analysis.marketId} label="market id" chars={10} />
            </KeyValue>
          </Panel>

          <Panel title="Levels">
            <KeyValue label="Entry">
              <span className="num">{pct(analysis.entryPrice, 1)}</span>
            </KeyValue>
            <KeyValue label="Target">
              <span className="num">{pct(analysis.targetPrice, 1)}</span>
            </KeyValue>
            <KeyValue label="Stop">
              <span className="num">{pct(analysis.stopLossPrice, 1)}</span>
            </KeyValue>
            <KeyValue label="Hit price">
              <span className="num">{pct(analysis.outcomeHitPrice, 1)}</span>
            </KeyValue>
            <KeyValue label="Resolved">{formatDateTime(analysis.outcomeResolvedAt)}</KeyValue>
            <KeyValue label="Agents scored">
              <Badge tone={analysis.agentsScored ? "yes" : "neutral"}>
                {analysis.agentsScored ? "yes" : "no"}
              </Badge>
            </KeyValue>
          </Panel>

          <Panel title="Shadow config" description="Recorded for comparison; never user-facing.">
            <KeyValue label="Action">
              <StatusPill status={analysis.shadowAction} />
            </KeyValue>
            <KeyValue label="Probability">
              <span className="num">{pct(analysis.shadowProbability)}</span>
            </KeyValue>
            <KeyValue label="Edge">
              <span className="num">{pct(analysis.shadowEdge, 1)}</span>
            </KeyValue>
            <KeyValue label="Vote score">
              <span className="num">
                {analysis.shadowVoteScore === null ? "—" : analysis.shadowVoteScore.toFixed(2)}
              </span>
            </KeyValue>
            <KeyValue label="Reason">
              {analysis.shadowReason ? analysis.shadowReason.replace(/_/g, " ") : "—"}
            </KeyValue>
            <KeyValue label="Live / shadow P&L">
              <span className="num text-[11.5px]">
                {analysis.livePnl === null ? "—" : analysis.livePnl.toFixed(4)} /{" "}
                {analysis.shadowPnl === null ? "—" : analysis.shadowPnl.toFixed(4)}
              </span>
            </KeyValue>
            <KeyValue label="Horizon">
              {analysis.horizonHours === null ? "—" : `${analysis.horizonHours}h`}
            </KeyValue>
          </Panel>

          <Panel
            title="Payload"
            description="Fetched directly from S3 with a short-lived presigned URL — never proxied through the API."
            className="md:col-span-2"
          >
            <PayloadViewer url={analysis.payloadUrl} />
          </Panel>
        </div>
      )}

      {isLoading && <p className="text-[11.5px] text-muted">Loading analysis…</p>}
    </Page>
  );
}
