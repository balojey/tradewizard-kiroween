/**
 * Dashboard queries.
 *
 * Reads the pre-computed daily rollup, never the OLTP tables. The only live
 * numbers on the overview come from CloudWatch (via the ops route) or from the
 * latest rollup row.
 */

import type { Client } from 'pg';

export interface DashboardDay {
  day: string;
  signups: number;
  activeUsers: number;
  analysesExecuted: number;
  analysesDelivered: number;
  creditsConsumed: number;
  revenueUsdc: number;
  pmActiveSessions: number;
  pmRealizedPnl: number;
}

export async function getDashboard(
  client: Client,
  days: number
): Promise<{ days: DashboardDay[]; totals: Record<string, number>; stale: boolean }> {
  const result = await client.query(
    `
    SELECT
      to_char(day, 'YYYY-MM-DD') AS "day",
      signups,
      active_users        AS "activeUsers",
      analyses_executed   AS "analysesExecuted",
      analyses_delivered  AS "analysesDelivered",
      credits_consumed    AS "creditsConsumed",
      revenue_usdc::float8 AS "revenueUsdc",
      pm_active_sessions  AS "pmActiveSessions",
      pm_realized_pnl::float8 AS "pmRealizedPnl",
      updated_at          AS "updatedAt"
    FROM admin_metrics_daily
    WHERE day > (now() AT TIME ZONE 'UTC')::date - ($1::int + 1)
    ORDER BY day DESC
    `,
    [days]
  );

  const rows = result.rows as unknown as Array<DashboardDay & { updatedAt: string }>;

  const totals = rows.reduce(
    (accumulator, row) => ({
      signups: accumulator.signups + Number(row.signups ?? 0),
      analysesExecuted: accumulator.analysesExecuted + Number(row.analysesExecuted ?? 0),
      analysesDelivered: accumulator.analysesDelivered + Number(row.analysesDelivered ?? 0),
      creditsConsumed: accumulator.creditsConsumed + Number(row.creditsConsumed ?? 0),
      revenueUsdc: accumulator.revenueUsdc + Number(row.revenueUsdc ?? 0),
      pmRealizedPnl: accumulator.pmRealizedPnl + Number(row.pmRealizedPnl ?? 0),
    }),
    {
      signups: 0,
      analysesExecuted: 0,
      analysesDelivered: 0,
      creditsConsumed: 0,
      revenueUsdc: 0,
      pmRealizedPnl: 0,
    }
  );

  // If the newest row is older than ~2 hours, the hourly rollup is not running.
  const newest = rows[0]?.updatedAt ? new Date(rows[0].updatedAt).getTime() : null;
  const stale = newest === null || Date.now() - newest > 2 * 60 * 60 * 1000;

  return {
    days: rows.map(({ updatedAt, ...row }) => row),
    totals,
    stale,
  };
}
