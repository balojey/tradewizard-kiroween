"use client";

import { useState } from "react";
import { DataTable, type Column } from "@/components/data/DataTable";
import { Pagination, SelectFilter, Toolbar } from "@/components/data/Filters";
import { CopyableId, PlanBadge, StatusPill, TimeCell } from "@/components/domain/Primitives";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Card";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { StatCard, StatGrid } from "@/components/ui/Stat";
import { Segmented, Tabs } from "@/components/ui/Tabs";
import { useCursorStack } from "@/hooks/useCursorStack";
import { useBillingSummary, usePayments, useSubscriptions } from "@/hooks/useBillingAgents";
import { formatCredits, formatDate, formatNumber, formatUsdc } from "@/lib/format";
import type { LedgerPayment, SubscriptionRow } from "@/types/admin";

const PLANS = [
  { value: "", label: "All plans" },
  { value: "free", label: "Free" },
  { value: "starter", label: "Starter" },
  { value: "pro", label: "Pro" },
  { value: "elite", label: "Elite" },
];

const RENEWAL = [
  { value: "", label: "All renewals" },
  { value: "ok", label: "OK" },
  { value: "failing", label: "Failing" },
  { value: "grace", label: "In grace" },
  { value: "paused", label: "Paused (comp)" },
];

const WINDOWS = [7, 30, 90] as const;

function PaymentsTab() {
  const stack = useCursorStack("payments");
  const { data, isLoading } = usePayments(stack.cursor, true);

  const columns: Column<LedgerPayment>[] = [
    { key: "created", header: "When", render: (row) => <TimeCell value={row.createdAt} /> },
    {
      key: "user",
      header: "Account",
      render: (row) => (
        <span className="text-[12px]">{row.userEmail ?? row.userId.slice(0, 8)}</span>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (row) => <span className="text-[12px]">{row.type.replace(/_/g, " ")}</span>,
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
        emptyMessage="No payments in the ledger."
        emptyHint="Settled USDC.e transfers appear here; credits spend does not."
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

function SubscriptionsTab({ plan, renewal }: { plan: string; renewal: string }) {
  const stack = useCursorStack(`${plan}|${renewal}`);
  const { data, isLoading } = useSubscriptions({ plan, renewal }, stack.cursor, true);

  const columns: Column<SubscriptionRow>[] = [
    {
      key: "user",
      header: "Account",
      render: (row) => (
        <span className="text-[12px]">{row.userEmail ?? row.userId.slice(0, 8)}</span>
      ),
    },
    { key: "plan", header: "Plan", render: (row) => <PlanBadge plan={row.plan} /> },
    { key: "status", header: "Status", render: (row) => <StatusPill status={row.status} /> },
    {
      key: "renewal",
      header: "Renewal",
      render: (row) => (
        <Badge
          dot
          tone={
            row.renewalState === "ok"
              ? "yes"
              : row.renewalState === "grace"
                ? "warning"
                : row.renewalState === "failing"
                  ? "no"
                  : "neutral"
          }
        >
          {row.renewalState}
        </Badge>
      ),
    },
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
      key: "cycle",
      header: "Cycle ends",
      align: "right",
      render: (row) => (
        <span className="whitespace-nowrap text-[11.5px] text-muted">
          {formatDate(row.billingCycleEnd)}
        </span>
      ),
    },
    {
      key: "trial",
      header: "Trial",
      align: "right",
      render: (row) => (
        <span className="whitespace-nowrap text-[11.5px] text-muted">
          {row.isTrial ? formatDate(row.trialEnd) : "—"}
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
        emptyMessage="No subscriptions match these filters."
        emptyHint="Every account has a subscription row, including the free plan."
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

export function BillingView({
  tab,
  onTabChange,
  plan,
  renewal,
  onFilterChange,
}: {
  tab: "payments" | "subscriptions";
  onTabChange: (tab: "payments" | "subscriptions") => void;
  plan: string;
  renewal: string;
  onFilterChange: (changes: Record<string, string | null>) => void;
}) {
  const [windowDays, setWindowDays] = useState(7);
  const { data: summary } = useBillingSummary(windowDays);

  const byPlanMax = Math.max(1, ...(summary?.byPlan.map((row) => row.count) ?? [1]));
  const renewalRisk = (summary?.renewal.pastDue ?? 0) + (summary?.renewal.inGrace ?? 0);
  const health: Array<[string, number]> = [
    ["Active", summary?.renewal.active ?? 0],
    ["Trials", summary?.renewal.trials ?? 0],
    ["In grace", summary?.renewal.inGrace ?? 0],
    ["Past due", summary?.renewal.pastDue ?? 0],
    ["Paused", summary?.renewal.paused ?? 0],
    ["Cancelled", summary?.renewal.cancelled ?? 0],
  ];

  return (
    <Page>
      <PageHeader
        title="Billing"
        description="On-chain USDC.e ledger and subscription state. Read-only: reconciliation ships with the mutation slice."
        actions={
          <Segmented
            label="Window"
            value={windowDays}
            onChange={setWindowDays}
            items={WINDOWS.map((days) => ({ value: days, label: `${days}d` }))}
          />
        }
        meta={
          <>
            <span>{formatNumber(summary?.revenue.payments ?? 0)} payments</span>
            <span aria-hidden className="text-border-strong">·</span>
            <span>{formatNumber(summary?.revenue.payers ?? 0)} distinct payers</span>
            <span aria-hidden className="text-border-strong">·</span>
            <span>window {windowDays} days</span>
          </>
        }
      />

      <StatGrid>
        <StatCard
          label="Revenue"
          value={formatUsdc(summary?.revenue.totalUsdc ?? 0)}
          hint={`${formatNumber(summary?.revenue.payments ?? 0)} payments`}
        />
        <StatCard
          label="Subscriptions"
          value={formatUsdc(summary?.revenue.subscriptionUsdc ?? 0)}
          hint="recurring portion"
        />
        <StatCard
          label="Credit packs"
          value={formatUsdc(summary?.revenue.creditPackUsdc ?? 0)}
          hint="one-off purchases"
        />
        <StatCard
          label="Renewal risk"
          value={formatNumber(renewalRisk)}
          tone={(summary?.renewal.pastDue ?? 0) > 0 ? "no" : renewalRisk > 0 ? "warning" : "neutral"}
          hint={`${formatNumber(summary?.renewal.inGrace ?? 0)} in grace · ${formatNumber(summary?.renewal.paused ?? 0)} paused`}
        />
      </StatGrid>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Active subscriptions by plan">
          {summary?.byPlan.length ? (
            <ul className="flex flex-col gap-2">
              {summary.byPlan.map((row) => (
                <li key={row.plan} className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-[11.5px] text-muted">{row.plan}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-[2px] bg-surface-2">
                    <span
                      className="block h-full rounded-[2px] bg-accent/70"
                      style={{
                        width: `${Math.max(2, Math.round((row.count / byPlanMax) * 100))}%`,
                      }}
                    />
                  </span>
                  <span className="num w-10 text-right text-[11.5px]">{row.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11.5px] text-faint">No active subscriptions.</p>
          )}
        </Panel>

        <Panel title="Subscription health">
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11.5px]">
            {health.map(([label, value]) => (
              <li key={label} className="flex items-center justify-between gap-2 border-b border-border-soft pb-1">
                <span className="text-muted">{label}</span>
                <span className="num text-fg">{formatNumber(value)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Tabs
        className="mb-4 mt-4"
        value={tab}
        onChange={onTabChange}
        items={[
          { key: "payments", label: "Payments" },
          { key: "subscriptions", label: "Subscriptions" },
        ]}
      />

      {tab === "subscriptions" && (
        <Toolbar>
          <SelectFilter
            label="Plan"
            value={plan}
            options={PLANS}
            onChange={(value) => onFilterChange({ plan: value || null })}
          />
          <SelectFilter
            label="Renewal"
            value={renewal}
            options={RENEWAL}
            onChange={(value) => onFilterChange({ renewal: value || null })}
          />
        </Toolbar>
      )}

      {tab === "payments" ? <PaymentsTab /> : <SubscriptionsTab plan={plan} renewal={renewal} />}
    </Page>
  );
}
