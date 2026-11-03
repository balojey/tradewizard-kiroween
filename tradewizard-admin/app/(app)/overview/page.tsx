"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Notice } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Card";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { StatCard, StatGrid } from "@/components/ui/Stat";
import { Segmented } from "@/components/ui/Tabs";
import { ROLE_DESCRIPTION, ROLE_LABEL, hasRole } from "@/constants/roles";
import { useAdminMe } from "@/hooks/useAdminMe";
import { useDashboard } from "@/hooks/useDashboard";
import { formatDate, formatNumber, formatUsdc } from "@/lib/format";
import type { AdminIdentity } from "@/constants/roles";
import type { DashboardDay } from "@/types/admin";

const WINDOWS = [7, 30, 90] as const;

const CAPABILITIES: Array<{ label: string; requires: "analyst" | "support" | "admin" | "owner" }> = [
  { label: "Read every record", requires: "analyst" },
  { label: "Grant credits, add notes", requires: "support" },
  { label: "Refund analyses, pause sessions", requires: "support" },
  { label: "Suspend, ban, override plans", requires: "admin" },
  { label: "Kill switch, terminate sessions", requires: "admin" },
  { label: "Manage portal members", requires: "owner" },
];

function AccessPanel({ identity }: { identity: AdminIdentity }) {
  return (
    <Panel
      title="Your access"
      actions={<Badge tone="accent">{ROLE_LABEL[identity.role]}</Badge>}
    >
      <p className="text-[11.5px] leading-relaxed text-muted">{ROLE_DESCRIPTION[identity.role]}</p>

      <ul className="mt-3 flex flex-col gap-1.5">
        {CAPABILITIES.map((capability) => {
          const allowed = hasRole(identity.role, capability.requires);

          return (
            <li key={capability.label} className="flex items-center justify-between gap-3 text-[11.5px]">
              <span className={allowed ? "text-fg" : "text-faint"}>{capability.label}</span>
              <span className={allowed ? "text-yes" : "text-faint"}>
                {allowed ? "allowed" : `needs ${capability.requires}`}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border-soft pt-3">
        {identity.mfa ? (
          <Badge tone="yes" dot>
            <ShieldCheck size={10} aria-hidden /> TOTP verified
          </Badge>
        ) : (
          <Badge tone="warning" dot>
            no second factor
          </Badge>
        )}
        <Badge tone={identity.linked ? "warning" : "neutral"} dot>
          {identity.linked ? "shared customer account" : "dedicated admin account"}
        </Badge>
        <Badge tone="neutral">{identity.email}</Badge>
      </div>
    </Panel>
  );
}

const SHORTCUTS = [
  { href: "/users", label: "Users", hint: "Find an account, adjust credits or plan" },
  { href: "/analyses", label: "Analyses", hint: "Inspect a result, refund, invalidate cache" },
  { href: "/portfolio", label: "Portfolio", hint: "Sessions, exposure and the kill switch" },
  { href: "/ops", label: "Ops", hint: "Queues, Lambda health, alarms" },
] as const;

function ShortcutsPanel() {
  return (
    <Panel title="Common tasks" description="Where each job starts.">
      <ul className="flex flex-col">
        {SHORTCUTS.map((item, index) => (
          <li key={item.href} className={index > 0 ? "border-t border-border-soft" : ""}>
            <Link
              href={item.href}
              className="group flex items-center justify-between gap-3 py-2 transition-colors hover:text-accent"
            >
              <span className="min-w-0">
                <span className="block text-[12.5px] text-fg group-hover:text-accent">
                  {item.label}
                </span>
                <span className="block truncate text-[11px] text-faint">{item.hint}</span>
              </span>
              <ArrowUpRight
                size={13}
                aria-hidden
                className="shrink-0 text-faint transition-colors group-hover:text-accent"
              />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ActivityRow({ day, max }: { day: DashboardDay; max: number }) {
  const width = max > 0 ? Math.max(2, Math.round((day.analysesExecuted / max) * 100)) : 0;

  return (
    <tr className="border-b border-border-soft last:border-0">
      <td className="whitespace-nowrap py-1.5 pr-3 text-[11.5px] text-muted">
        <span className="mono">{formatDate(day.day).slice(0, 6)}</span>
      </td>
      <td className="py-1.5 pr-3">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-full max-w-[220px] overflow-hidden rounded-[2px] bg-surface-2">
            <span
              className="block h-full rounded-[2px] bg-accent/70"
              style={{ width: `${width}%` }}
            />
          </span>
          <span className="num w-10 text-right text-[11.5px] text-fg">{day.analysesExecuted}</span>
        </span>
      </td>
      <td className="num py-1.5 pr-3 text-right text-[11.5px] text-muted">{day.signups}</td>
      <td className="num py-1.5 pr-3 text-right text-[11.5px] text-muted">{day.creditsConsumed}</td>
      <td className="num py-1.5 text-right text-[11.5px] text-muted">
        {day.revenueUsdc > 0 ? formatUsdc(day.revenueUsdc) : "—"}
      </td>
    </tr>
  );
}

export default function OverviewPage() {
  const { data: identity } = useAdminMe();
  const [days, setDays] = useState<number>(30);
  const { data, isLoading, error } = useDashboard(days);

  const ordered = useMemo(() => [...(data?.days ?? [])].reverse(), [data?.days]);

  if (!identity) return null;

  const totals = data?.totals;
  const maxExecuted = Math.max(1, ...ordered.map((day) => day.analysesExecuted));
  const latest = data?.days[0];
  const bodyText = "text-[11.5px]";

  return (
    <Page>
      <PageHeader
        title="Overview"
        description="Rolled up hourly from the product database. Use it to spot direction, not to audit a single account."
        actions={
          <Segmented
            label="Window"
            value={days}
            onChange={setDays}
            items={WINDOWS.map((option) => ({ value: option, label: `${option}d` }))}
          />
        }
        meta={
          <>
            <span>Last {days} days</span>
            <span aria-hidden className="text-border-strong">·</span>
            <span>
              latest rollup day{" "}
              <span className="text-fg">{latest ? formatDate(latest.day) : "—"}</span>
            </span>
          </>
        }
      />

      {identity?.linked && (
        <Notice tone="warning" className="mb-4">
          <strong className="text-fg">This admin account is also a customer account.</strong> The
          portal password and TOTP factor replace the password the product derives for magic-link
          sign-in, so this person&apos;s product login can break without warning. Give the operator a
          dedicated admin email instead — runbook §1.
        </Notice>
      )}

      {error && (
        <Notice tone="error" title="Could not load metrics" className="mb-4">
          {(error as Error).message}
        </Notice>
      )}

      {data?.stale && (
        <Notice
          tone="warning"
          title="Rollup is behind"
          className="mb-4"
          action={
            <Link href="/ops" className="text-[11.5px] text-accent hover:underline">
              Check ops
            </Link>
          }
        >
          The hourly rollup has not run in over two hours, so these numbers may lag.
        </Notice>
      )}

      <StatGrid className="lg:grid-cols-3">
        <StatCard
          label="Signups"
          value={formatNumber(totals?.signups ?? 0)}
          hint={`new accounts · ${days}d`}
          sparkline={ordered.map((day) => day.signups)}
        />
        <StatCard
          label="Analyses executed"
          value={formatNumber(totals?.analysesExecuted ?? 0)}
          hint={`${formatNumber(totals?.analysesDelivered ?? 0)} deliveries`}
          sparkline={ordered.map((day) => day.analysesExecuted)}
        />
        <StatCard
          label="Credits consumed"
          value={formatNumber(totals?.creditsConsumed ?? 0)}
          hint="across all plans"
          sparkline={ordered.map((day) => day.creditsConsumed)}
        />
        <StatCard
          label="Revenue"
          value={formatUsdc(totals?.revenueUsdc ?? 0)}
          hint="USDC.e, settled on-chain"
          sparkline={ordered.map((day) => day.revenueUsdc)}
          sparklineTone="yes"
        />
        <StatCard
          label="PM realised P&L"
          value={formatUsdc(totals?.pmRealizedPnl ?? 0)}
          hint="closed positions, all sessions"
          tone={
            (totals?.pmRealizedPnl ?? 0) > 0
              ? "yes"
              : (totals?.pmRealizedPnl ?? 0) < 0
                ? "no"
                : "neutral"
          }
          sparkline={ordered.map((day) => day.pmRealizedPnl)}
          sparklineTone={(totals?.pmRealizedPnl ?? 0) >= 0 ? "yes" : "no"}
        />
        <StatCard
          label="Latest day"
          value={latest ? formatDate(latest.day) : "—"}
          hint={
            latest
              ? `${formatNumber(latest.analysesExecuted)} runs · ${formatNumber(latest.signups)} signups`
              : "no rollup rows yet"
          }
        />
      </StatGrid>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Panel
            title="Daily activity"
            description="Executions, signups and credits per rollup day."
            actions={<Badge tone="neutral">{ordered.length} days</Badge>}
            bodyClassName="px-0 py-0"
          >
            {isLoading && !data && (
              <p className="px-4 py-8 text-center text-[11.5px] text-muted">Loading rollup…</p>
            )}

            {data && ordered.length === 0 && (
              <p className="px-4 py-8 text-center text-[11.5px] text-muted">
                No rollup rows yet. The hourly schedule will fill them.
              </p>
            )}

            {ordered.length > 0 && (
              <div className="max-h-[360px] overflow-y-auto px-4 py-2">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 bg-surface">
                    <tr>
                      <th className="micro py-1.5 pr-3 text-left">Day</th>
                      <th className="micro py-1.5 pr-3 text-left">Executions</th>
                      <th className="micro py-1.5 pr-3 text-right">New</th>
                      <th className="micro py-1.5 pr-3 text-right">Cr.</th>
                      <th className="micro py-1.5 text-right">Rev.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordered.map((day) => (
                      <ActivityRow key={day.day} day={day} max={maxExecuted} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Reading the numbers" bodyClassName="px-4 py-3">
            <ul className={["flex flex-col gap-1.5 text-muted", bodyText].join(" ")}>
              <li>
                <span className="text-fg">Executions</span> are analysis runs, including cached
                deliveries. A market served from cache still counts once per delivery.
              </li>
              <li>
                <span className="text-fg">Revenue</span> is settled USDC.e on Polygon; it excludes
                credits spend, which never touches the chain.
              </li>
              <li>
                <span className="text-fg">PM realised P&amp;L</span> only includes closed positions.
                Open exposure lives on the portfolio page.
              </li>
            </ul>
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <AccessPanel identity={identity} />
          <ShortcutsPanel />
        </div>
      </div>
    </Page>
  );
}
