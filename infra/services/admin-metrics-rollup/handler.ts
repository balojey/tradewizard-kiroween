/**
 * Admin metrics rollup.
 *
 * Runs hourly and (re)computes the row for today and yesterday in
 * `admin_metrics_daily`. The portal's overview reads this table instead of
 * aggregating live OLTP data — a dashboard must never be a query hazard for the
 * product database.
 *
 * Idempotent by design: every run recomputes the same days with `ON CONFLICT DO
 * UPDATE`, so re-running mid-day simply refreshes partial counts.
 *
 * Days are UTC. That is deliberate: the portal displays UTC everywhere, and a
 * local-midnight boundary would make the numbers unreproducible.
 */

import type { Client } from 'pg';
import { getConnectionString } from '../shared/db';
import { expireOverrides } from '../shared/plan-overrides';

interface RollupRow {
  day: string;
}

async function upsertDay(client: Client, day: string): Promise<void> {
  await client.query(
    `
    WITH bounds AS (
      SELECT
        $1::date AS day,
        ($1::date)::timestamptz AS start_ts,
        (($1::date) + 1)::timestamptz AS end_ts
    )
    INSERT INTO admin_metrics_daily (
      day, signups, active_users, analyses_executed, analyses_delivered,
      credits_consumed, revenue_usdc, pm_active_sessions, pm_realized_pnl, updated_at
    )
    SELECT
      b.day,
      (SELECT count(*) FROM users u
        WHERE u.created_at >= b.start_ts AND u.created_at < b.end_ts)::int,
      (SELECT count(DISTINCT d.user_id) FROM analysis_deliveries d
        WHERE d.delivered_at >= b.start_ts AND d.delivered_at < b.end_ts)::int,
      (SELECT count(*) FROM analysis_results r
        WHERE r.executed_at >= b.start_ts AND r.executed_at < b.end_ts)::int,
      (SELECT count(*) FROM analysis_deliveries d
        WHERE d.delivered_at >= b.start_ts AND d.delivered_at < b.end_ts)::int,
      (SELECT coalesce(-sum(ct.amount), 0) FROM credit_transactions ct
        WHERE ct.amount < 0 AND ct.created_at >= b.start_ts AND ct.created_at < b.end_ts)::int,
      (SELECT coalesce(sum(pt.amount_usdc), 0) FROM payment_transactions pt
        WHERE pt.created_at >= b.start_ts AND pt.created_at < b.end_ts)::numeric(14, 4),
      (SELECT count(*) FROM portfolio_manager_sessions s
        WHERE s.created_at < b.end_ts
          AND (s.terminated_at IS NULL OR s.terminated_at >= b.end_ts))::int,
      (SELECT coalesce(sum(t.realized_pnl), 0) FROM portfolio_manager_trades t
        WHERE t.realized_pnl IS NOT NULL
          AND t.created_at >= b.start_ts AND t.created_at < b.end_ts)::numeric(14, 4),
      now()
    FROM bounds b
    ON CONFLICT (day) DO UPDATE SET
      signups = EXCLUDED.signups,
      active_users = EXCLUDED.active_users,
      analyses_executed = EXCLUDED.analyses_executed,
      analyses_delivered = EXCLUDED.analyses_delivered,
      credits_consumed = EXCLUDED.credits_consumed,
      revenue_usdc = EXCLUDED.revenue_usdc,
      pm_active_sessions = EXCLUDED.pm_active_sessions,
      pm_realized_pnl = EXCLUDED.pm_realized_pnl,
      updated_at = now()
    `,
    [day]
  );
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Payload is optional. Without one, the handler refreshes today and yesterday.
 * `{ "days": ["2026-10-29", ...] }` backfills specific days, which is how a new
 * environment gets history without waiting a month.
 */
export async function handler(event?: { days?: unknown }): Promise<{ days: string[] }> {
  const { Client: PgClient } = await import('pg');
  const connectionString = await getConnectionString();

  const client = new PgClient({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    await client.query(`SET statement_timeout = 20000`);

    const requested = Array.isArray(event?.days)
      ? event!.days.filter(
          (day): day is string => typeof day === 'string' && DAY_PATTERN.test(day)
        )
      : [];

    const rolled =
      requested.length > 0
        ? requested
        : (
            await client.query<RollupRow>(`
              SELECT to_char((now() AT TIME ZONE 'UTC')::date - interval '1 day', 'YYYY-MM-DD') AS day
              UNION ALL
              SELECT to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day
            `)
          ).rows.map((row) => row.day);

    for (const day of rolled) {
      await upsertDay(client, day);
    }

    // Comped plans expire on time rather than relying on someone remembering to
    // revoke them. Co-located with the rollup because both are hourly
    // maintenance; no second schedule to pay for or forget to monitor.
    const expired = await expireOverrides(client);
    if (expired.length > 0) {
      console.log(`Expired ${expired.length} plan override(s)`);
    }
    console.log(`Admin metrics rollup complete: ${rolled.join(', ')}`);
    return { days: rolled };
  } finally {
    await client.end().catch(() => undefined);
  }
}
