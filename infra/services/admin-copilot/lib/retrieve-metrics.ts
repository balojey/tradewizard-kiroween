/**
 * Operational metrics retrieval.
 *
 * Two time windows, both explicit, both bounded by an indexed range scan:
 * the last hour (what just changed) and the last day (what normal looks like).
 * These are counts, not live aggregates over the hot product tables.
 *
 * See docs/plans/warden-ai-copilot.md §5.
 */

import type { Client } from 'pg';
import type { RetrievedRecord } from '../types';

export interface MetricWindow {
  label: string;
  from: string;
  to: string;
}

const WINDOWS: Array<{ id: 'last_hour' | 'last_24h'; label: string; hours: number }> = [
  { id: 'last_hour', label: 'Last hour', hours: 1 },
  { id: 'last_24h', label: 'Last 24 hours', hours: 24 },
];

export async function retrieveMetrics(
  client: Client,
  options: { to?: Date } = {}
): Promise<{ records: RetrievedRecord[]; windows: MetricWindow[] }> {
  const to = options.to ?? new Date();

  const records: RetrievedRecord[] = [];
  const windows: MetricWindow[] = [];

  for (const window of WINDOWS) {
    const from = new Date(to.getTime() - window.hours * 3_600_000);

    const [audit, analyses] = await Promise.all([
      client.query<{ total: string; failed: string }>(
        `
        SELECT count(*)::text AS total,
               count(*) FILTER (WHERE status = 'failed')::text AS failed
        FROM admin_audit_log
        WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
        `,
        [from.toISOString(), to.toISOString()]
      ),
      client.query<{ total: string; noTrade: string }>(
        `
        SELECT count(*)::text AS total,
               count(*) FILTER (WHERE recommendation = 'NO_TRADE')::text AS "noTrade"
        FROM analysis_results
        WHERE executed_at >= $1::timestamptz AND executed_at < $2::timestamptz
        `,
        [from.toISOString(), to.toISOString()]
      ),
    ]);

    const auditTotal = Number(audit.rows[0]?.total ?? 0);
    const auditFailed = Number(audit.rows[0]?.failed ?? 0);
    const analysesTotal = Number(analyses.rows[0]?.total ?? 0);
    const noTrade = Number(analyses.rows[0]?.noTrade ?? 0);

    const metricWindow: MetricWindow = {
      label: window.label,
      from: from.toISOString(),
      to: to.toISOString(),
    };
    windows.push(metricWindow);

    records.push({
      type: 'metric',
      id: window.id,
      label: `Metrics · ${window.label}`,
      url: '/ops',
      data: {
        window: window.label,
        from: metricWindow.from,
        to: metricWindow.to,
        adminActions: auditTotal,
        adminActionsFailed: auditFailed,
        analysesExecuted: analysesTotal,
        analysesNoTrade: noTrade,
        noTradeRate: analysesTotal > 0 ? Number((noTrade / analysesTotal).toFixed(3)) : null,
      },
    });
  }

  return { records, windows };
}
