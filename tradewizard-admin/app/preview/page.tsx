"use client";

import { AdminShell } from "@/components/shell/AdminShell";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Card";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { StatCard, StatGrid } from "@/components/ui/Stat";
import { Tabs } from "@/components/ui/Tabs";
import { DataTable, type Column } from "@/components/data/DataTable";
import { Toolbar, SearchInput, SelectFilter, ToggleFilter } from "@/components/data/Filters";
import { PlanBadge, StatusPill } from "@/components/domain/Primitives";
import type { UserSummary } from "@/types/admin";

const rows: UserSummary[] = [
  {
    id: "1",
    email: "ada@example.com",
    displayName: "Ada Lovelace",
    status: "active",
    createdAt: new Date(Date.now() - 86400000 * 12).toISOString(),
    plan: "elite",
    subscriptionStatus: "active",
    creditsRemaining: 42,
    creditsMonthlyLimit: 100,
    billingCycleEnd: new Date(Date.now() + 86400000 * 9).toISOString(),
  },
  {
    id: "2",
    email: "grace@example.com",
    displayName: null,
    status: "suspended",
    createdAt: new Date(Date.now() - 86400000 * 40).toISOString(),
    plan: "pro",
    subscriptionStatus: "past_due",
    creditsRemaining: 0,
    creditsMonthlyLimit: 50,
    billingCycleEnd: new Date(Date.now() + 86400000 * 2).toISOString(),
  },
  {
    id: "3",
    email: "linus@example.com",
    displayName: "Linus",
    status: "active",
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    plan: "free",
    subscriptionStatus: "trialing",
    creditsRemaining: 5,
    creditsMonthlyLimit: 5,
    billingCycleEnd: null,
  },
];

const columns: Column<UserSummary>[] = [
  {
    key: "email",
    header: "Account",
    render: (row) => (
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-fg">{row.email}</span>
        {row.displayName && <span className="truncate text-[11px] text-faint">{row.displayName}</span>}
      </span>
    ),
  },
  { key: "plan", header: "Plan", render: (row) => <PlanBadge plan={row.plan} /> },
  { key: "status", header: "Status", render: (row) => <StatusPill status={row.status} /> },
  {
    key: "credits",
    header: "Credits",
    align: "right",
    render: (row) => (
      <span className="num text-[12px]">
        {row.creditsRemaining} / {row.creditsMonthlyLimit}
      </span>
    ),
  },
];

export default function PreviewPage() {
  return (
    <AdminShell
      identity={{
        sub: "s",
        email: "operator@tradewizard.io",
        role: "admin",
        roleRank: 30,
        mfa: true,
        userId: "u",
        linked: true,
      }}
    >
      <Page>
        <PageHeader
          title="Users"
          description="Customer accounts, their plan and credit balance. Open a row for the ledger, sessions and support notes."
          meta={
            <>
              <span>3 shown</span>
              <span aria-hidden className="text-border-strong">·</span>
              <span>newest first</span>
            </>
          }
        />
        <StatGrid>
          <StatCard label="Signups" value="1,204" hint="new accounts · 30d" sparkline={[3, 5, 4, 8, 6, 9, 7, 12]} />
          <StatCard label="Analyses executed" value="38,921" hint="12,004 deliveries" sparkline={[20, 24, 19, 28, 26, 31, 30, 36]} />
          <StatCard label="Revenue" value="$12,480.00" hint="USDC.e, settled on-chain" sparkline={[1, 2, 2, 3, 4, 4, 6, 7]} sparklineTone="yes" />
          <StatCard label="Risk flags" value="3" tone="warning" hint="2 near loss limit · 1 size-reduced" />
        </StatGrid>
        <div className="mt-4">
          <Tabs
            value="members"
            onChange={() => {}}
            items={[
              { key: "members", label: "Members", count: 3 },
              { key: "roles", label: "Roles" },
            ]}
          />
        </div>
        <div className="mt-4">
          <Toolbar>
            <SearchInput label="Search" value="" onChange={() => {}} placeholder="Email or display name" />
            <SelectFilter label="Plan" value="" options={[{ value: "", label: "All plans" }]} onChange={() => {}} />
            <ToggleFilter label="Has portfolio manager" checked onChange={() => {}} />
          </Toolbar>
          <DataTable columns={columns} rows={rows} getRowId={(row) => row.id} getRowHref={() => "/users/1"} />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Panel title="Your access" actions={<Badge tone="accent">Admin</Badge>}>
            <p className="text-[11.5px] leading-relaxed text-muted">
              All mutations except settings and role changes.
            </p>
          </Panel>
          <Panel title="Common tasks" description="Where each job starts.">
            <p className="text-[11.5px] text-muted">Users → Analyses → Portfolio</p>
          </Panel>
        </div>
      </Page>
    </AdminShell>
  );
}
