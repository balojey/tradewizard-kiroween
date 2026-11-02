/**
 * Read queries for the market-level analysis pool.
 *
 * The pool is one row per market (`market_analysis_schedule`), shared by every
 * user. The portal needs to see what is scheduled, what is executing, and —
 * most importantly — what is *wedged*: `is_executing` with a stale
 * `execution_started_at` blocks that market forever.
 */

import type { Client } from 'pg';
import type { Cursor } from '../lib/pagination';

/** A run executing for longer than this is considered stuck. */
export const STUCK_AFTER_MINUTES = 15;

export interface ScheduleFilters {
  status: string | null;
  stuckOnly: boolean;
}

export async function listSchedules(
  client: Client,
  filters: ScheduleFilters,
  limit: number,
  cursor: Cursor | null
): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    `
    SELECT
      s.id,
      s.market_id                AS "marketId",
      m.question                 AS "marketQuestion",
      s.shortest_interval_seconds AS "intervalSeconds",
      s.next_scheduled_run       AS "nextScheduledRun",
      s.last_completed_at        AS "lastCompletedAt",
      s.last_result_id           AS "lastResultId",
      s.is_executing             AS "isExecuting",
      s.execution_started_at     AS "executionStartedAt",
      s.status,
      s.updated_at               AS "updatedAt",
      (
        s.is_executing
        AND s.execution_started_at IS NOT NULL
        AND s.execution_started_at < now() - ($2 || ' minutes')::interval
      ) AS "stuck"
    FROM market_analysis_schedule s
    LEFT JOIN markets m ON m.condition_id = s.market_id
    WHERE ($1::text IS NULL OR s.status = $1)
      AND (
        $3::boolean = false
        OR (
          s.is_executing
          AND s.execution_started_at IS NOT NULL
          AND s.execution_started_at < now() - ($2 || ' minutes')::interval
        )
      )
      AND (
        $4::timestamptz IS NULL
        OR (s.next_scheduled_run, s.id) > ($4::timestamptz, $5::uuid)
      )
    ORDER BY s.next_scheduled_run ASC, s.id ASC
    LIMIT $6
    `,
    [
      filters.status,
      String(STUCK_AFTER_MINUTES),
      filters.stuckOnly,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      limit + 1,
    ]
  );

  return result.rows;
}

export async function getScheduleSummary(
  client: Client
): Promise<Record<string, unknown>> {
  const result = await client.query(
    `
    SELECT
      count(*)::int AS "total",
      count(*) FILTER (WHERE status = 'active')::int AS "active",
      count(*) FILTER (WHERE is_executing)::int AS "executing",
      count(*) FILTER (
        WHERE is_executing
          AND execution_started_at IS NOT NULL
          AND execution_started_at < now() - ($1 || ' minutes')::interval
      )::int AS "stuck",
      count(*) FILTER (
        WHERE status = 'active' AND next_scheduled_run < now() + interval '15 minutes'
      )::int AS "dueSoon",
      max(last_completed_at) AS "lastCompletedAt"
    FROM market_analysis_schedule
    `,
    [String(STUCK_AFTER_MINUTES)]
  );

  return result.rows[0] ?? {};
}
