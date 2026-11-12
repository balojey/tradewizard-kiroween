"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { DataTable, type Column } from "@/components/data/DataTable";
import { Pagination } from "@/components/data/Filters";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Card";
import { CopyableId, KeyValue, Pnl, StatusPill, TimeCell } from "@/components/domain/Primitives";
import { Notice } from "@/components/ui/Notice";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { Tabs } from "@/components/ui/Tabs";
import { SessionControls } from "@/components/portfolio/SessionControls";
import { CopilotPanel } from "@/components/copilot/CopilotPanel";
import { hasRole } from "@/constants/roles";
import { KillSwitchControl } from "@/components/users/KillSwitchControl";
import { useAdminMe } from "@/hooks/useAdminMe";
import { useCursorStack } from "@/hooks/useCursorStack";
import { useSession, useSessionDecisions, useSessionTrades } from "@/hooks/usePortfolio";
import { formatDateTime, formatUsdc } from "@/lib/format";
import type { PortfolioDecisionRow, PortfolioTradeRow } from "@/types/admin";

const TABS = ["trades", "decisions"] as const;
type Tab = (typeof TABS)[number];

function TradesTab({ sessionId }: { sessionId: string }) {
  const stack = useCursorStack(sessionId);
  const { data, isLoading } = useSessionTrades(sessionId, stack.cursor, true);

  const columns: Column<PortfolioTradeRow>[] = [
    { key: "created", header: "When", render: (row) => <TimeCell value={row.createdAt} /> },
    {
      key: "side",
      header: "Side",
      render: (row) => (
        <span className="text-[12px]">
          {row.side} {row.direction}
        </span>
      ),
    },
    {
      key: "purpose",
      header: "Purpose",
      render: (row) => (
        <span className="text-[11.5px] text-muted">{row.tradePurpose.replace(/_/g, " ")}</span>
      ),
    },
    {
      key: "size",
      header: "Size",
      align: "right",
      render: (row) => <span className="num text-[12px]">{formatUsdc(row.sizeUsdc)}</span>,
    },
    {
      key: "price",
      header: "Price",
      align: "right",
      render: (row) => <span className="num text-[11.5px] text-muted">{row.price.toFixed(3)}</span>,
    },
    {
      key: "fill",
      header: "Fill",
      align: "right",
      render: (row) => (
        <span className="num text-[11.5px] text-muted">
          {row.fillPrice === null ? "—" : row.fillPrice.toFixed(3)}
        </span>
      ),
    },
    { key: "status", header: "Status", render: (row) => <StatusPill status={row.status} /> },
    { key: "pnl", header: "P&L", align: "right", render: (row) => <Pnl value={row.realizedPnl} /> },
    {
      key: "reasoning",
      header: "Reasoning",
      render: (row) => (
        <span
          className="block max-w-[260px] truncate text-[11px] text-muted"
          title={row.reasoning ?? ""}
        >
          {row.reasoning ?? "—"}
        </span>
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading}
        emptyMessage="No trades in this session."
        emptyHint="Sessions only trade when the decision gate is passed."
      />
      <Pagination
        hasNext={Boolean(data?.nextCursor)}
        canPrev={stack.canPrev}
        loading={isLoading}
        onNext={() => data?.nextCursor && stack.next(data.nextCursor)}
        onPrev={stack.prev}
      />
    </>
  );
}

function DecisionsTab({ sessionId }: { sessionId: string }) {
  const stack = useCursorStack(sessionId);
  const { data, isLoading } = useSessionDecisions(sessionId, stack.cursor, true);

  const columns: Column<PortfolioDecisionRow>[] = [
    { key: "created", header: "When", render: (row) => <TimeCell value={row.createdAt} /> },
    { key: "action", header: "Action", render: (row) => <StatusPill status={row.action} /> },
    {
      key: "conviction",
      header: "Conviction",
      align: "right",
      render: (row) => (
        <span className="num text-[12px] text-muted">
          {row.convictionScore === null ? "—" : row.convictionScore.toFixed(2)}
        </span>
      ),
    },
    {
      key: "edge",
      header: "Edge met",
      render: (row) => (
        <Badge tone={row.edgeMet ? "yes" : "neutral"}>
          {row.edgeMet === null ? "—" : row.edgeMet ? "yes" : "no"}
        </Badge>
      ),
    },
    {
      key: "align",
      header: "Aligned",
      render: (row) => (
        <Badge tone={row.alignmentMet ? "yes" : "neutral"}>
          {row.alignmentMet === null ? "—" : row.alignmentMet ? "yes" : "no"}
        </Badge>
      ),
    },
    {
      key: "position",
      header: "Position",
      render: (row) => (
        <span className="text-[11.5px] text-muted">
          {row.hadPosition ? (row.positionDirection ?? "open") : "flat"}
        </span>
      ),
    },
    {
      key: "reasoning",
      header: "Reasoning",
      render: (row) => (
        <span
          className="block max-w-[320px] truncate text-[11px] text-muted"
          title={row.reasoning}
        >
          {row.skipReason ? `skip: ${row.skipReason.replace(/_/g, " ")} — ` : ""}
          {row.reasoning}
        </span>
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading}
        emptyMessage="No decisions recorded."
      />
      <Pagination
        hasNext={Boolean(data?.nextCursor)}
        canPrev={stack.canPrev}
        loading={isLoading}
        onNext={() => data?.nextCursor && stack.next(data.nextCursor)}
        onPrev={stack.prev}
      />
    </>
  );
}

export function SessionDetailView() {
  const routeParams = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const sessionId = Array.isArray(routeParams.id) ? routeParams.id[0] : routeParams.id;
  const tabParam = searchParams.get("tab") as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : "trades";

  const { data: session, isLoading, error } = useSession(sessionId);
  const { data: identity } = useAdminMe();

  if (error) {
    return (
      <Page>
        <Notice
          tone="error"
          title="Could not load this session"
          action={
            <Link href="/portfolio" className="text-[11.5px] text-accent hover:underline">
              Back to portfolio
            </Link>
          }
        >
          {(error as Error).message}
        </Notice>
      </Page>
    );
  }

  const winRate =
    session && session.totalTrades > 0
      ? Math.round((session.winningTrades / session.totalTrades) * 100)
      : null;

  return (
    <Page>
      <PageHeader
        crumbs={[{ label: "Portfolio", href: "/portfolio" }, { label: sessionId.slice(0, 8) + "…" }]}
        title={isLoading ? "Loading session…" : (session?.marketQuestion ?? session?.marketId ?? "Session")}
        actions={
          session && (
            <>
              <SessionControls sessionId={session.id} userId={session.userId} identity={identity} status={session.status} />
              {/* The halt belongs next to the session it would stop, not only on
                  the user page: this is where a runaway is noticed. */}
              <KillSwitchControl userId={session.userId} identity={identity} />
            </>
          )
        }
        meta={
          session && (
            <>
              <Badge tone="ai">{session.personaId}</Badge>
              <StatusPill status={session.status} />
              {session.userEmail && <span>{session.userEmail}</span>}
              <span aria-hidden className="text-border-strong">·</span>
              <span className="flex items-center gap-1">
                <span className="text-faint">user</span>
                <CopyableId value={session.userId} label="user id" chars={8} />
              </span>
              <span className="flex items-center gap-1">
                <span className="text-faint">session</span>
                <CopyableId value={session.id} label="session id" chars={8} />
              </span>
            </>
          )
        }
      />

      {session && identity && hasRole(identity.role, "support") && (
        <div className="mb-4">
          <CopilotPanel
            kind="session"
            title="Ask Warden"
            description="Reads this session's trades, decisions, and the analysis that drove the last decision. Read-only — pausing or terminating stays with the controls above."
            context={{ sessionId: session.id }}
            placeholder="e.g. Why did it exit here?"
            prompts={[
              { label: "Explain this session" },
              {
                label: "What happened before the exit?",
                question:
                  "What happened before the exit? Walk the last trades and decisions in order and cite them.",
              },
            ]}
          />
        </div>
      )}

      {session && (
        <div className="grid gap-4 md:grid-cols-3">
          <Panel title="Capital">
            <KeyValue label="Invested">
              <span className="num">{formatUsdc(session.investmentAmount)}</span>
            </KeyValue>
            <KeyValue label="At risk">
              <span className="num">{formatUsdc(session.amountInPositions)}</span>
            </KeyValue>
            <KeyValue label="Pending">
              <span className="num">{formatUsdc(session.amountInPendingOrders)}</span>
            </KeyValue>
            <KeyValue label="Available">
              <span className="num">{formatUsdc(session.amountAvailable)}</span>
            </KeyValue>
            <KeyValue label="Profit target">
              {session.profitTargetPct === null ? "—" : `${session.profitTargetPct}%`}
            </KeyValue>
          </Panel>

          <Panel title="Performance">
            <KeyValue label="Realised">
              <Pnl value={session.realizedPnl} />
            </KeyValue>
            <KeyValue label="Unrealised">
              <Pnl value={session.unrealizedPnl} />
            </KeyValue>
            <KeyValue label="Trades">
              <span className="num text-[12px]">
                {session.winningTrades}/{session.totalTrades}
                {winRate !== null ? ` · ${winRate}% win` : ""}
              </span>
            </KeyValue>
            <KeyValue label="Decisions">
              <span className="num text-[12px]">{session.decisionsTotal}</span>
            </KeyValue>
            <KeyValue label="Hold time">
              <span className="num text-[12px]">{session.totalHoldDurationMinutes} min</span>
            </KeyValue>
          </Panel>

          <Panel title="Risk">
            <KeyValue label="Loss (cumulative)">
              <span
                className={`num ${session.cumulativeLossPct >= 0.4 ? "text-no" : "text-fg"}`}
              >
                {Math.round(session.cumulativeLossPct * 100)}%
              </span>
            </KeyValue>
            <KeyValue label="Size reduction">
              <Badge tone={session.positionSizeReductionActive ? "warning" : "neutral"} dot>
                {session.positionSizeReductionActive ? "active" : "off"}
              </Badge>
            </KeyValue>
            <KeyValue label="Last loss exit">
              {session.lastLossExitAt ? formatDateTime(session.lastLossExitAt) : "—"}
            </KeyValue>
            <KeyValue label="Position">
              {session.positionDirection
                ? `${session.positionDirection} @ ${session.positionEntryPrice?.toFixed(3) ?? "—"}`
                : "flat"}
            </KeyValue>
            <KeyValue label="Ended">
              {session.terminatedAt
                ? `${formatDateTime(session.terminatedAt)} (${session.terminationReason ?? "—"})`
                : "running"}
            </KeyValue>
          </Panel>
        </div>
      )}

      <Tabs
        className="mb-4 mt-5"
        value={tab}
        onChange={(key) =>
          router.replace(`/portfolio/${sessionId}${key === "trades" ? "" : `?tab=${key}`}`)
        }
        items={TABS.map((key) => ({
          key,
          label: key === "trades" ? "Trades" : "Decisions",
        }))}
      />

      {tab === "trades" ? <TradesTab sessionId={sessionId} /> : <DecisionsTab sessionId={sessionId} />}
    </Page>
  );
}
