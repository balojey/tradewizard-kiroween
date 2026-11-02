/**
 * Read queries for the analyses domain.
 *
 * Two shapes:
 * - **executions**: paginated rows (one per analysis result), keyset-paginated
 * - **quality**: bounded-window aggregates. The window is always explicit
 *   (default 7 days, max 90) because these are the only queries in the portal
 *   that scan more than one user's data.
 */

import type { Client } from 'pg';
import type { Cursor } from '../lib/pagination';

export interface AnalysisFilters {
  marketId: string | null;
  userId: string | null;
  recommendation: string | null;
  outcome: string | null;
  noTradeReason: string | null;
  from: string | null;
  to: string | null;
}

const EXECUTION_COLUMNS = `
  r.id,
  r.market_id              AS "marketId",
  m.question               AS "marketQuestion",
  r.executed_at            AS "executedAt",
  r.recommendation,
  r.consensus_probability::float8 AS "consensusProbability",
  r.confidence_score::float8      AS "confidence",
  r.edge::float8                  AS edge,
  r.outcome_status         AS "outcomeStatus",
  r.no_trade_reason        AS "noTradeReason",
  r.shadow_action          AS "shadowAction",
  r.shadow_edge::float8    AS "shadowEdge",
  r.total_llm_calls        AS "totalLlmCalls",
  r.model_costs_usd::float8 AS "modelCostsUsd",
  r.execution_duration_ms  AS "executionDurationMs"
`;

export async function listAnalyses(
  client: Client,
  filters: AnalysisFilters,
  limit: number,
  cursor: Cursor | null
): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    `
    SELECT ${EXECUTION_COLUMNS}
    FROM analysis_results r
    LEFT JOIN markets m ON m.condition_id = r.market_id
    WHERE ($1::text IS NULL OR r.market_id = $1)
      AND ($2::uuid IS NULL OR EXISTS (
        SELECT 1 FROM analysis_deliveries d
        WHERE d.result_id = r.id AND d.user_id = $2::uuid
      ))
      AND ($3::text IS NULL OR r.recommendation = $3)
      AND ($4::text IS NULL OR r.outcome_status = $4)
      AND ($5::text IS NULL OR r.no_trade_reason = $5)
      AND ($6::timestamptz IS NULL OR r.executed_at >= $6::timestamptz)
      AND ($7::timestamptz IS NULL OR r.executed_at < $7::timestamptz)
      AND (
        $8::timestamptz IS NULL
        OR (r.executed_at, r.id) < ($8::timestamptz, $9::uuid)
      )
    ORDER BY r.executed_at DESC, r.id DESC
    LIMIT $10
    `,
    [
      filters.marketId,
      filters.userId,
      filters.recommendation,
      filters.outcome,
      filters.noTradeReason,
      filters.from,
      filters.to,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      limit + 1,
    ]
  );

  return result.rows;
}

/** Just the market id, for cache invalidation. */
export async function getAnalysisMarketId(
  client: Client,
  analysisId: string
): Promise<string | null> {
  const result = await client.query(
    'SELECT market_id AS "marketId" FROM analysis_results WHERE id = $1 LIMIT 1',
    [analysisId]
  );
  return (result.rows[0]?.marketId as string | undefined) ?? null;
}

export async function getAnalysisById(
  client: Client,
  analysisId: string
): Promise<Record<string, unknown> | null> {
  const result = await client.query(
    `
    SELECT
      ${EXECUTION_COLUMNS},
      r.result_payload_s3_key  AS "payloadKey",
      r.market_probability_at_execution::float8 AS "marketProbability",
      r.entry_price::float8    AS "entryPrice",
      r.target_price::float8   AS "targetPrice",
      r.stop_loss_price::float8 AS "stopLossPrice",
      r.outcome_hit_price::float8 AS "outcomeHitPrice",
      r.outcome_resolved_at    AS "outcomeResolvedAt",
      r.agents_scored          AS "agentsScored",
      r.shadow_probability::float8 AS "shadowProbability",
      r.shadow_vote_score::float8  AS "shadowVoteScore",
      r.shadow_cost_floor::float8  AS "shadowCostFloor",
      r.shadow_reason          AS "shadowReason",
      r.horizon_hours          AS "horizonHours",
      r.horizon_move::float8   AS "horizonMove",
      r.live_pnl::float8       AS "livePnl",
      r.shadow_pnl::float8     AS "shadowPnl",
      r.pnl_scored_at          AS "pnlScoredAt",
      r.created_at             AS "createdAt"
    FROM analysis_results r
    LEFT JOIN markets m ON m.condition_id = r.market_id
    WHERE r.id = $1
    LIMIT 1
    `,
    [analysisId]
  );

  return result.rows[0] ?? null;
}

export interface QualityWindow {
  from: string;
  to: string;
}

export interface QualityReport {
  window: QualityWindow;
  totals: Record<string, unknown>;
  recommendations: Array<{ label: string; count: number }>;
  noTradeReasons: Array<{ reason: string; count: number }>;
  edgeBuckets: Array<{ bucket: string; count: number }>;
  outcomes: Array<{ status: string; count: number }>;
  shadow: Record<string, unknown>;
}

export async function getQualityReport(
  client: Client,
  window: QualityWindow
): Promise<QualityReport> {
  const params = [window.from, window.to];

  const [totals, recommendations, noTradeReasons, edgeBuckets, outcomes, shadow] =
    await Promise.all([
      client.query(
        `
        SELECT
          count(*)::int                                   AS "executions",
          count(DISTINCT market_id)::int                   AS "markets",
          avg(consensus_probability)::float8               AS "avgProbability",
          avg(execution_duration_ms)::float8               AS "avgDurationMs",
          sum(model_costs_usd)::float8                     AS "totalCostUsd",
          avg(edge)::float8                                AS "avgEdge"
        FROM analysis_results
        WHERE executed_at >= $1::timestamptz AND executed_at < $2::timestamptz
        `,
        params
      ),
      client.query(
        `
        SELECT coalesce(recommendation, 'NONE') AS label, count(*)::int AS count
        FROM analysis_results
        WHERE executed_at >= $1::timestamptz AND executed_at < $2::timestamptz
        GROUP BY 1
        ORDER BY 2 DESC
        `,
        params
      ),
      client.query(
        `
        SELECT coalesce(no_trade_reason, '(none)') AS reason, count(*)::int AS count
        FROM analysis_results
        WHERE executed_at >= $1::timestamptz AND executed_at < $2::timestamptz
          AND (recommendation = 'NO_TRADE' OR recommendation IS NULL)
        GROUP BY 1
        ORDER BY 2 DESC
        `,
        params
      ),
      client.query(
        `
        SELECT
          CASE
            WHEN edge IS NULL THEN 'n/a'
            WHEN abs(edge) < 0.02 THEN '<2%'
            WHEN abs(edge) < 0.05 THEN '2-5%'
            WHEN abs(edge) < 0.10 THEN '5-10%'
            WHEN abs(edge) < 0.15 THEN '10-15%'
            ELSE '>=15%'
          END AS bucket,
          count(*)::int AS count
        FROM analysis_results
        WHERE executed_at >= $1::timestamptz AND executed_at < $2::timestamptz
        GROUP BY 1
        `,
        params
      ),
      client.query(
        `
        SELECT outcome_status AS status, count(*)::int AS count
        FROM analysis_results
        WHERE executed_at >= $1::timestamptz AND executed_at < $2::timestamptz
        GROUP BY 1
        ORDER BY 2 DESC
        `,
        params
      ),
      client.query(
        `
        SELECT
          count(*) FILTER (WHERE shadow_action IS NOT NULL)::int  AS "withShadow",
          count(*) FILTER (WHERE shadow_action = recommendation)::int AS "agree",
          count(*) FILTER (WHERE shadow_action IS NOT NULL AND shadow_action <> recommendation)::int AS "disagree",
          count(*) FILTER (WHERE pnl_scored_at IS NOT NULL)::int  AS "scored",
          avg(live_pnl)::float8   AS "avgLivePnl",
          avg(shadow_pnl)::float8 AS "avgShadowPnl"
        FROM analysis_results
        WHERE executed_at >= $1::timestamptz AND executed_at < $2::timestamptz
        `,
        params
      ),
    ]);

  return {
    window,
    totals: totals.rows[0] ?? {},
    recommendations: recommendations.rows as Array<{ label: string; count: number }>,
    noTradeReasons: noTradeReasons.rows as Array<{ reason: string; count: number }>,
    edgeBuckets: edgeBuckets.rows as Array<{ bucket: string; count: number }>,
    outcomes: outcomes.rows as Array<{ status: string; count: number }>,
    shadow: shadow.rows[0] ?? {},
  };
}
