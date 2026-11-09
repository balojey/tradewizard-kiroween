"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { DataTable, type Column } from "@/components/data/DataTable";
import { Pagination } from "@/components/data/Filters";
import { CopyableId, KeyValue, Pnl, PlanBadge, StatusPill, TimeCell } from "@/components/domain/Primitives";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { Tabs } from "@/components/ui/Tabs";
import { GrantCreditsDialog } from "@/components/users/GrantCreditsDialog";
import { KillSwitchControl } from "@/components/users/KillSwitchControl";
import { PlanOverrideControl } from "@/components/users/PlanOverrideControl";
import { SuspensionControl } from "@/components/users/SuspensionControl";
import { NoteForm } from "@/components/users/NoteForm";
import { useAdminMe } from "@/hooks/useAdminMe";
import { useCursorStack } from "@/hooks/useCursorStack";
import {
  useUser,
  useUserAnalyses,
  useUserCredits,
  useUserNotes,
  useUserPayments,
  useUserSessions,
} from "@/hooks/useUsers";
import { formatCredits, formatDateTime, formatNumber, formatUsdc } from "@/lib/format";
import type { AdminIdentity } from "@/constants/roles";
import type { AnalysisRow, CreditRow, NoteRow, PaymentRow, SessionRow } from "@/types/admin";

const TABS = ["overview", "credits", "analyses", "sessions", "payments", "notes"] as const;
type Tab = (typeof TABS)[number];

function CreditsTab({ userId }: { userId: string }) {
  const stack = useCursorStack(userId);
  const { data, isLoading } = useUserCredits(userId, stack.cursor, true);

  const columns: Column<CreditRow>[] = [
    { key: "created", header: "When", render: (row) => <TimeCell value={row.createdAt} /> },
    {
      key: "amount",
      header: "Change",
      align: "right",
      render: (row) => (
        <span className={`num text-[12px] ${row.amount > 0 ? "text-yes" : "text-no"}`}>
          {row.amount > 0 ? "+" : ""}
          {row.amount}
        </span>
      ),
    },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      render: (row) => <span className="num text-[12px]">{row.balanceAfter}</span>,
    },
    { key: "reason", header: "Reason", render: (row) => <span className="text-[12px]">{row.reason}</span> },
    {
      key: "source",
      header: "Source",
      render: (row) => <span className="text-[11.5px] text-muted">{row.creditSource ?? "—"}</span>,
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading}
        emptyMessage="No credit activity yet."
        emptyHint="Grants, purchases and deductions all appear here in order."
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

function AnalysesTab({ userId }: { userId: string }) {
  const stack = useCursorStack(userId);
  const { data, isLoading } = useUserAnalyses(userId, stack.cursor, true);

  const columns: Column<AnalysisRow>[] = [
    { key: "delivered", header: "Delivered", render: (row) => <TimeCell value={row.deliveredAt} /> },
    {
      key: "market",
      header: "Market",
      render: (row) => (
        <span
          className="block max-w-[340px] truncate text-[12px]"
          title={row.marketQuestion ?? row.marketId}
        >
          {row.marketQuestion ?? row.marketId}
        </span>
      ),
    },
    { key: "rec", header: "Call", render: (row) => <StatusPill status={row.recommendation} /> },
    {
      key: "prob",
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
    { key: "outcome", header: "Outcome", render: (row) => <StatusPill status={row.outcomeStatus} /> },
    {
      key: "channel",
      header: "Channel",
      render: (row) => <span className="text-[11.5px] text-muted">{row.channel}</span>,
    },
    {
      key: "cached",
      header: "Cached",
      render: (row) => (
        <Badge tone={row.wasCached ? "warning" : "neutral"}>{row.wasCached ? "cached" : "fresh"}</Badge>
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.deliveryId}
        loading={isLoading}
        emptyMessage="This user has not received any analyses."
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

function SessionsTab({ userId }: { userId: string }) {
  const stack = useCursorStack(userId);
  const { data, isLoading } = useUserSessions(userId, stack.cursor, true);

  const columns: Column<SessionRow>[] = [
    { key: "created", header: "Opened", render: (row) => <TimeCell value={row.createdAt} /> },
    {
      key: "market",
      header: "Market",
      render: (row) => (
        <span className="mono text-[11px] text-muted">{row.marketId.slice(0, 12)}…</span>
      ),
    },
    { key: "persona", header: "Persona", render: (row) => <span className="text-[12px]">{row.personaId}</span> },
    {
      key: "invested",
      header: "Invested",
      align: "right",
      render: (row) => <span className="num text-[12px]">{formatUsdc(row.investmentAmount)}</span>,
    },
    { key: "status", header: "Status", render: (row) => <StatusPill status={row.status} /> },
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
    { key: "pnl", header: "Realised", align: "right", render: (row) => <Pnl value={row.realizedPnl} /> },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        getRowHref={(row) => `/portfolio/${row.id}`}
        loading={isLoading}
        emptyMessage="No portfolio sessions."
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

function PaymentsTab({ userId }: { userId: string }) {
  const stack = useCursorStack(userId);
  const { data, isLoading } = useUserPayments(userId, stack.cursor, true);

  const columns: Column<PaymentRow>[] = [
    { key: "created", header: "When", render: (row) => <TimeCell value={row.createdAt} /> },
    {
      key: "type",
      header: "Type",
      render: (row) => <span className="text-[12px]">{row.transactionType.replace(/_/g, " ")}</span>,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (row) => <span className="num text-[12px]">{formatUsdc(row.amountUsdc)}</span>,
    },
    {
      key: "plan",
      header: "Plan / pack",
      render: (row) => (
        <span className="text-[11.5px] text-muted">{row.plan ?? row.creditPackId ?? "—"}</span>
      ),
    },
    {
      key: "credits",
      header: "Credits",
      align: "right",
      render: (row) => <span className="num text-[12px]">{row.creditsAdded ?? "—"}</span>,
    },
    {
      key: "tx",
      header: "Transaction",
      render: (row) => <CopyableId value={row.txHash} label="tx hash" chars={10} />,
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading}
        emptyMessage="No on-chain payments."
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

function NotesTab({ userId, identity }: { userId: string; identity?: AdminIdentity }) {
  const stack = useCursorStack(userId);
  const { data, isLoading } = useUserNotes(userId, stack.cursor, true);

  const columns: Column<NoteRow>[] = [
    { key: "created", header: "When", render: (row) => <TimeCell value={row.createdAt} /> },
    {
      key: "author",
      header: "Author",
      render: (row) => <span className="text-[11.5px] text-muted">{row.authorEmail}</span>,
    },
    {
      key: "body",
      header: "Note",
      render: (row) => (
        <span className="block max-w-[560px] whitespace-pre-wrap text-[12px]">{row.body}</span>
      ),
    },
  ];

  return (
    <>
      <NoteForm userId={userId} identity={identity} />
      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading}
        emptyMessage="No support notes yet."
        emptyHint="Notes are permanent and visible to every operator who can read this account."
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

function OverviewTab({ userId }: { userId: string }) {
  const { data: user } = useUser(userId);
  if (!user) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Panel title="Subscription">
        <KeyValue label="Plan">
          <span className="flex items-center justify-end gap-2">
            <PlanBadge plan={user.plan} />
            <StatusPill status={user.subscriptionStatus} />
          </span>
        </KeyValue>
        <KeyValue label="Credits">
          <span className="num">{formatCredits(user.creditsRemaining, user.creditsMonthlyLimit)}</span>
        </KeyValue>
        <KeyValue label="Cycle ends">{formatDateTime(user.billingCycleEnd)}</KeyValue>
        <KeyValue label="Trial">{user.isTrial ? formatDateTime(user.trialEnd) : "no"}</KeyValue>
        <KeyValue label="Renewal">
          {user.renewalPausedAt ? (
            <Badge tone="warning" dot>
              paused
            </Badge>
          ) : (
            <Badge tone="neutral" dot>
              normal
            </Badge>
          )}
        </KeyValue>
      </Panel>

      <Panel title="Activity">
        <KeyValue label="Analyses delivered">
          <span className="num">{formatNumber(user.analysesDelivered)}</span>
        </KeyValue>
        <KeyValue label="Portfolio sessions">
          <span className="num">{formatNumber(user.sessionsTotal)}</span>
        </KeyValue>
        <KeyValue label="Payments">
          <span className="num">{formatNumber(user.paymentsTotal)}</span>
        </KeyValue>
        <KeyValue label="Lifetime USDC">
          <span className="num">{formatUsdc(user.lifetimeUsdc)}</span>
        </KeyValue>
        <KeyValue label="Ever on a paid plan">
          {user.hasUsedPaidPlan ? <Badge tone="yes">yes</Badge> : <Badge tone="neutral">no</Badge>}
        </KeyValue>
      </Panel>

      <Panel title="Identity">
        <KeyValue label="users.id">
          <CopyableId value={user.id} label="users.id" chars={10} />
        </KeyValue>
        <KeyValue label="Cognito sub">
          <CopyableId value={user.cognitoSub} label="cognito sub" chars={10} />
        </KeyValue>
        <KeyValue label="Wallet">
          <CopyableId value={user.walletAddress} label="wallet" chars={8} />
        </KeyValue>
        <KeyValue label="Default persona">{user.portfolioPersonaId ?? "—"}</KeyValue>
      </Panel>

      <Panel title="Lifecycle">
        <KeyValue label="Signed up">{formatDateTime(user.createdAt)}</KeyValue>
        <KeyValue label="Last profile update">{formatDateTime(user.updatedAt)}</KeyValue>
        <KeyValue label="Account status">
          <StatusPill status={user.status} />
        </KeyValue>
        {user.portfolioPersonaParams && (
          <KeyValue label="Persona overrides">
            <span className="mono text-[11px]">
              {Object.keys(user.portfolioPersonaParams).join(", ") || "—"}
            </span>
          </KeyValue>
        )}
      </Panel>
    </div>
  );
}

export function UserDetailView() {
  const routeParams = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const userId = Array.isArray(routeParams.id) ? routeParams.id[0] : routeParams.id;
  const tabParam = searchParams.get("tab") as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : "overview";

  const { data: user, isLoading, error } = useUser(userId);
  const { data: identity } = useAdminMe();

  if (error) {
    return (
      <Page>
        <Notice
          tone="error"
          title="Could not load this user"
          action={
            <Link href="/users" className="text-[11.5px] text-accent hover:underline">
              Back to users
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
        crumbs={[{ label: "Users", href: "/users" }, { label: user?.email ?? "Loading…" }]}
        title={isLoading ? "Loading account…" : (user?.email ?? "Account")}
        description={user?.displayName ?? undefined}
        actions={
          user && (
            <>
              <GrantCreditsDialog
                userId={user.id}
                identity={identity}
                currentBalance={user.creditsRemaining}
              />
              <SuspensionControl userId={user.id} identity={identity} status={user.status} />
              <KillSwitchControl userId={user.id} identity={identity} />
              <PlanOverrideControl
                userId={user.id}
                identity={identity}
                currentPlan={user.plan}
                overridePlan={user.overridePlan}
                overrideExpiresAt={user.overrideExpiresAt}
              />
            </>
          )
        }
        meta={
          user && (
            <>
              <PlanBadge plan={user.plan} />
              <StatusPill status={user.status} />
              <span aria-hidden className="text-border-strong">·</span>
              <span className="flex items-center gap-1">
                <span className="text-faint">id</span>
                <CopyableId value={user.id} label="users.id" chars={8} />
              </span>
              <span aria-hidden className="text-border-strong">·</span>
              <span>joined {formatDateTime(user.createdAt)}</span>
            </>
          )
        }
      />

      <Tabs
        className="mb-4"
        value={tab}
        onChange={(key) =>
          router.replace(`/users/${userId}${key === "overview" ? "" : `?tab=${key}`}`)
        }
        items={TABS.map((key) => ({
          key,
          label: key === "overview" ? "Overview" : key[0].toUpperCase() + key.slice(1),
        }))}
      />

      {tab === "overview" && <OverviewTab userId={userId} />}
      {tab === "credits" && <CreditsTab userId={userId} />}
      {tab === "analyses" && <AnalysesTab userId={userId} />}
      {tab === "sessions" && <SessionsTab userId={userId} />}
      {tab === "payments" && <PaymentsTab userId={userId} />}
      {tab === "notes" && <NotesTab userId={userId} identity={identity} />}
    </Page>
  );
}
