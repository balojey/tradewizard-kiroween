"use client";

import { useQuery } from "@tanstack/react-query";
import { DataTable, type Column } from "@/components/data/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { StatCard, StatGrid } from "@/components/ui/Stat";
import { adminFetch } from "@/lib/admin-api";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { OpsHealth } from "@/types/admin";

const COLUMNS: Column<OpsHealth["functions"][number]>[] = [
  {
    key: "name",
    header: "Function",
    render: (row) => (
      <span className="mono text-[11.5px] text-fg">
        {row.name.replace("tw-dev-", "").replace("tw-prod-", "")}
      </span>
    ),
  },
  {
    key: "inv",
    header: "Invocations",
    align: "right",
    render: (row) => <span className="num text-[12px]">{formatNumber(row.invocations)}</span>,
  },
  {
    key: "errors",
    header: "Errors",
    align: "right",
    render: (row) => (
      <span className={`num text-[12px] ${row.errors > 0 ? "text-no" : "text-muted"}`}>
        {formatNumber(row.errors)}
      </span>
    ),
  },
  {
    key: "rate",
    header: "Error rate",
    align: "right",
    render: (row) =>
      row.errorRate === null ? (
        <span className="text-faint">—</span>
      ) : (
        <Badge tone={row.errorRate === 0 ? "yes" : row.errorRate < 0.01 ? "warning" : "no"}>
          {(row.errorRate * 100).toFixed(2)}%
        </Badge>
      ),
  },
  {
    key: "throttles",
    header: "Throttles",
    align: "right",
    render: (row) => (
      <span className={`num text-[12px] ${row.throttles > 0 ? "text-warning" : "text-muted"}`}>
        {formatNumber(row.throttles)}
      </span>
    ),
  },
  {
    key: "duration",
    header: "Avg duration",
    align: "right",
    render: (row) => (
      <span className="num text-[12px] text-muted">
        {row.avgDurationMs ? `${Math.round(row.avgDurationMs)}ms` : "—"}
      </span>
    ),
  },
];

function QueuePanel({
  title,
  queue,
  danger,
}: {
  title: string;
  queue: OpsHealth["queues"]["analysis"];
  danger?: boolean;
}) {
  if (!queue) {
    return (
      <Panel title={title}>
        <p className="text-[11.5px] text-faint">Not configured for this environment.</p>
      </Panel>
    );
  }

  const blocked = danger && queue.visible > 0;
  const waiting = queue.visible + queue.inFlight + queue.delayed;

  return (
    <Panel
      title={title}
      actions={
        blocked ? (
          <Badge tone="no" dot>
            needs attention
          </Badge>
        ) : (
          <Badge tone={waiting > 0 ? "warning" : "yes"} dot>
            {waiting > 0 ? "moving" : "clear"}
          </Badge>
        )
      }
    >
      <div className="grid grid-cols-3 gap-2">
        <div>
          <div className="micro">Visible</div>
          <div className={`num mt-0.5 text-[18px] ${blocked ? "text-no" : "text-fg"}`}>
            {formatNumber(queue.visible)}
          </div>
        </div>
        <div>
          <div className="micro">In flight</div>
          <div className="num mt-0.5 text-[18px] text-fg">{formatNumber(queue.inFlight)}</div>
        </div>
        <div>
          <div className="micro">Oldest</div>
          <div className="num mt-0.5 text-[18px] text-fg">
            {queue.oldestMessageAgeSeconds === null ? "—" : `${queue.oldestMessageAgeSeconds}s`}
          </div>
        </div>
      </div>
    </Panel>
  );
}

export function OpsView() {
  const { idToken } = useAdminAuth();

  const { data, isLoading, error, refetch, isFetching } = useQuery<OpsHealth>({
    queryKey: ["admin", "ops", "health"],
    queryFn: () => adminFetch<OpsHealth>("admin/ops/health", { token: idToken }),
    enabled: Boolean(idToken),
    retry: false,
    staleTime: 30_000,
  });

  const dbSizeMb = data?.database.sizeBytes ? data.database.sizeBytes / 1024 / 1024 : null;
  const firing = data?.alarms.length ?? 0;

  return (
    <Page>
      <PageHeader
        title="Ops"
        description="Queues, Lambda health, alarms and database. Last 24 hours unless a panel says otherwise."
        actions={
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="inline-flex h-8 items-center rounded-[6px] border border-border-strong/60 bg-surface px-2.5 text-[11.5px] text-fg transition-colors hover:bg-surface-2 disabled:opacity-40"
          >
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
        }
        meta={
          data && (
            <>
              <span>generated {formatDateTime(data.generatedAt)}</span>
              <span aria-hidden className="text-border-strong">·</span>
              <span>{firing === 0 ? "no alarms firing" : `${firing} alarms firing`}</span>
            </>
          )
        }
      />

      {error && (
        <Notice tone="error" title="Could not load ops health" className="mb-4">
          {(error as Error).message}
        </Notice>
      )}

      {isLoading && <p className="text-[11.5px] text-muted">Loading health…</p>}

      {data && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <QueuePanel title="Analysis queue" queue={data.queues.analysis} />
            <QueuePanel title="Dead letter queue" queue={data.queues.deadLetter} danger />
          </div>

          <div className="mt-4">
            <StatGrid>
            <StatCard
              label="Database"
              value={data.database.reachable ? "reachable" : "unreachable"}
              tone={data.database.reachable ? "yes" : "no"}
              hint={`${data.database.connections ?? "—"} active connections`}
            />
            <StatCard
              label="DB size"
              value={dbSizeMb === null ? "—" : `${dbSizeMb.toFixed(1)} MB`}
              hint="single-AZ instance"
            />
            <StatCard
              label="WebSocket connections"
              value={
                data.websocket.approxConnections === null
                  ? "—"
                  : formatNumber(data.websocket.approxConnections)
              }
              hint="approximate by design"
            />
            <StatCard
              label="Alarms"
              value={firing === 0 ? "all OK" : formatNumber(firing)}
              tone={firing === 0 ? "yes" : "no"}
              hint="only non-OK states listed"
            />
          </StatGrid>
          </div>

          <Panel
            title="Alarms"
            description="Only alarms that are not OK are listed. Silence them in CloudWatch, then re-check here."
            className="mt-4"
            actions={
              <Badge tone={firing === 0 ? "yes" : "no"} dot>
                {firing === 0 ? "all OK" : `${firing} firing`}
              </Badge>
            }
          >
            {firing === 0 ? (
              <p className="py-1 text-[11.5px] text-muted">No alarms are currently firing.</p>
            ) : (
              <ul className="flex flex-col">
                {data.alarms.map((alarm) => (
                  <li
                    key={alarm.name}
                    className="flex items-start justify-between gap-3 border-b border-border-soft py-2 last:border-0"
                  >
                    <div className="min-w-0">
                      <div className="mono truncate text-[11.5px] text-fg">{alarm.name}</div>
                      {alarm.reason && (
                        <div className="mt-0.5 text-[11px] text-muted">{alarm.reason}</div>
                      )}
                    </div>
                    <Badge tone={alarm.state === "ALARM" ? "no" : "warning"} dot>
                      {alarm.state}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <div className="mt-4">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h2 className="text-[13px] font-medium text-fg">Lambda functions</h2>
              <span className="text-[11px] text-faint">window {data.windowHours}h</span>
            </div>

            <DataTable
              columns={COLUMNS}
              rows={data.functions}
              getRowId={(row) => row.name}
              loading={false}
              emptyMessage="No functions configured for monitoring."
            />
          </div>
        </>
      )}
    </Page>
  );
}
