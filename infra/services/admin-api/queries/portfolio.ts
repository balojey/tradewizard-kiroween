/**
 * Read queries for the portfolio manager domain.
 *
 * Deliberately separate from `shared/portfolio-db.ts`: those queries are
 * user-scoped and use `OFFSET` pagination, which is forbidden on the admin side
 * (it scans every skipped row). These are cross-user, keyset-paginated, and
 * read-only — the admin API never mutates a session through this module.
 */

import type { Client } from 'pg';
import type { Cursor } from '../lib/pagination';

export interface SessionFilters {
  status: string | null;
  userId: string | null;
  marketId: string | null;
}

const SESSION_COLUMNS = `
  p.id,
  p.user_id                AS "userId",
  u.email                  AS "userEmail",
  p.market_id              AS "marketId",
  m.question               AS "marketQuestion",
  p.persona_id             AS "personaId",
  p.status,
  p.investment_amount::float8       AS "investmentAmount",
  p.amount_in_positions::float8     AS "amountInPositions",
  p.amount_in_pending_orders::float8 AS "amountInPendingOrders",
  p.amount_available::float8        AS "amountAvailable",
  p.realized_pnl::float8            AS "realizedPnl",
  p.unrealized_pnl::float8          AS "unrealizedPnl",
  p.total_trades           AS "totalTrades",
  p.winning_trades         AS "winningTrades",
  p.position_direction     AS "positionDirection",
  p.cumulative_loss_pct::float8     AS "cumulativeLossPct",
  p.created_at             AS "createdAt",
  p.updated_at             AS "updatedAt",
  p.terminated_at          AS "terminatedAt"
`;

export async function listSessions(
  client: Client,
  filters: SessionFilters,
  limit: number,
  cursor: Cursor | null
): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    `
    SELECT ${SESSION_COLUMNS}
    FROM portfolio_manager_sessions p
    LEFT JOIN users u ON u.id = p.user_id
    LEFT JOIN markets m ON m.condition_id = p.market_id
    WHERE ($1::text IS NULL OR p.status = $1)
      AND ($2::uuid IS NULL OR p.user_id = $2::uuid)
      AND ($3::text IS NULL OR p.market_id = $3)
      AND (
        $4::timestamptz IS NULL
        OR (p.created_at, p.id) < ($4::timestamptz, $5::uuid)
      )
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT $6
    `,
    [
      filters.status,
      filters.userId,
      filters.marketId,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      limit + 1,
    ]
  );

  return result.rows;
}

export async function getSessionById(
  client: Client,
  sessionId: string
): Promise<Record<string, unknown> | null> {
  const result = await client.query(
    `
    SELECT
      ${SESSION_COLUMNS},
      p.persona_config          AS "personaConfig",
      p.position_size::float8    AS "positionSize",
      p.position_entry_price::float8 AS "positionEntryPrice",
      p.position_entry_at       AS "positionEntryAt",
      p.profit_target_pct::float8 AS "profitTargetPct",
      p.last_loss_exit_at       AS "lastLossExitAt",
      p.position_size_reduction_active AS "positionSizeReductionActive",
      p.termination_reason      AS "terminationReason",
      p.total_hold_duration_minutes AS "totalHoldDurationMinutes",
      (SELECT count(*) FROM portfolio_manager_trades t WHERE t.session_id = p.id)::int AS "tradesTotal",
      (SELECT count(*) FROM portfolio_manager_decisions d WHERE d.session_id = p.id)::int AS "decisionsTotal"
    FROM portfolio_manager_sessions p
    LEFT JOIN users u ON u.id = p.user_id
    LEFT JOIN markets m ON m.condition_id = p.market_id
    WHERE p.id = $1
    LIMIT 1
    `,
    [sessionId]
  );

  return result.rows[0] ?? null;
}

export async function sessionExists(client: Client, sessionId: string): Promise<boolean> {
  const result = await client.query(
    'SELECT 1 FROM portfolio_manager_sessions WHERE id = $1 LIMIT 1',
    [sessionId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listSessionTrades(
  client: Client,
  sessionId: string,
  limit: number,
  cursor: Cursor | null
): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    `
    SELECT
      t.id,
      t.analysis_result_id      AS "analysisResultId",
      t.direction,
      t.side,
      t.order_type              AS "orderType",
      t.size_usdc::float8       AS "sizeUsdc",
      t.price::float8           AS price,
      t.fill_price::float8      AS "fillPrice",
      t.shares::float8          AS shares,
      t.status,
      t.clob_order_id           AS "clobOrderId",
      t.trade_purpose           AS "tradePurpose",
      t.reasoning,
      t.conviction_score::float8 AS "convictionScore",
      t.created_at              AS "createdAt",
      t.filled_at               AS "filledAt",
      t.cancelled_at            AS "cancelledAt",
      t.realized_pnl::float8    AS "realizedPnl",
      t.hold_duration_minutes   AS "holdDurationMinutes",
      t.exit_reason             AS "exitReason"
    FROM portfolio_manager_trades t
    WHERE t.session_id = $1
      AND (
        $2::timestamptz IS NULL
        OR (t.created_at, t.id) < ($2::timestamptz, $3::uuid)
      )
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT $4
    `,
    [sessionId, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1]
  );

  return result.rows;
}

export async function listSessionDecisions(
  client: Client,
  sessionId: string,
  limit: number,
  cursor: Cursor | null
): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    `
    SELECT
      d.id,
      d.analysis_result_id      AS "analysisResultId",
      d.action,
      d.edge_met                AS "edgeMet",
      d.alignment_met           AS "alignmentMet",
      d.conviction_score::float8 AS "convictionScore",
      d.additional_criteria_met AS "additionalCriteriaMet",
      d.had_position            AS "hadPosition",
      d.position_direction      AS "positionDirection",
      d.position_unrealized_pnl::float8 AS "positionUnrealizedPnl",
      d.reasoning,
      d.skip_reason             AS "skipReason",
      d.created_at              AS "createdAt"
    FROM portfolio_manager_decisions d
    WHERE d.session_id = $1
      AND (
        $2::timestamptz IS NULL
        OR (d.created_at, d.id) < ($2::timestamptz, $3::uuid)
      )
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT $4
    `,
    [sessionId, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1]
  );

  return result.rows;
}

export interface ExposureReport {
  totals: Record<string, unknown>;
  byPersona: Array<Record<string, unknown>>;
}

/**
 * Aggregate open exposure. Scoped to sessions that can still trade or hold a
 * position (`active`, `paused`, `exiting`) — completed and terminated sessions
 * are history, not exposure.
 */
export async function getExposure(client: Client): Promise<ExposureReport> {
  const OPEN_STATUSES = `('active', 'paused', 'exiting')`;

  const [totals, byPersona] = await Promise.all([
    client.query(`
      SELECT
        count(*) FILTER (WHERE status IN ${OPEN_STATUSES})::int          AS "openSessions",
        count(*) FILTER (WHERE status = 'active')::int                    AS "activeSessions",
        count(DISTINCT user_id) FILTER (WHERE status IN ${OPEN_STATUSES})::int AS "users",
        coalesce(sum(amount_in_positions) FILTER (WHERE status IN ${OPEN_STATUSES}), 0)::float8     AS "capitalAtRisk",
        coalesce(sum(amount_available) FILTER (WHERE status IN ${OPEN_STATUSES}), 0)::float8        AS "capitalAvailable",
        coalesce(sum(unrealized_pnl) FILTER (WHERE status IN ${OPEN_STATUSES}), 0)::float8          AS "unrealizedPnl",
        coalesce(sum(realized_pnl) FILTER (WHERE status IN ${OPEN_STATUSES}), 0)::float8            AS "realizedPnl",
        coalesce(sum(amount_in_pending_orders) FILTER (WHERE status IN ${OPEN_STATUSES}), 0)::float8 AS "pendingOrders",
        count(*) FILTER (WHERE status IN ${OPEN_STATUSES} AND position_size_reduction_active)::int AS "sessionsReduced",
        count(*) FILTER (WHERE status IN ${OPEN_STATUSES} AND cumulative_loss_pct >= 0.40)::int    AS "sessionsNearLossLimit"
      FROM portfolio_manager_sessions
    `),
    client.query(`
      SELECT
        persona_id AS "personaId",
        count(*)::int AS "sessions",
        coalesce(sum(amount_in_positions), 0)::float8 AS "capitalAtRisk"
      FROM portfolio_manager_sessions
      WHERE status IN ${OPEN_STATUSES}
      GROUP BY 1
      ORDER BY 3 DESC
    `),
  ]);

  return {
    totals: totals.rows[0] ?? {},
    byPersona: byPersona.rows,
  };
}

/** Minimal session state for control actions. */
export async function getSessionState(
  client: Client,
  sessionId: string
): Promise<{ userId: string; status: string; accountStatus: string } | null> {
  const result = await client.query(
    `
    SELECT
      p.user_id AS "userId",
      p.status,
      u.status  AS "accountStatus"
    FROM portfolio_manager_sessions p
    LEFT JOIN users u ON u.id = p.user_id
    WHERE p.id = $1
    LIMIT 1
    `,
    [sessionId]
  );

  return (result.rows[0] as { userId: string; status: string; accountStatus: string } | undefined) ?? null;
}
