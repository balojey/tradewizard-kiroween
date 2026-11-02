/**
 * Read queries for agent quality and model cost.
 *
 * `agent_performance` is a small, bounded table (one row per agent), so it needs
 * no pagination. Costing is an aggregate over a bounded window.
 */

import type { Client } from 'pg';
import type { ReportingWindow } from '../lib/window';

export async function listAgentPerformance(
  client: Client
): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    `
    SELECT
      agent_name           AS "agentName",
      total_signals        AS "totalSignals",
      correct_signals      AS "correctSignals",
      accuracy_pct::float8 AS "accuracyPct",
      avg_confidence::float8 AS "avgConfidence",
      brier_score::float8  AS "brierScore",
      log_loss::float8     AS "logLoss",
      calibration_samples  AS "calibrationSamples",
      last_updated_at      AS "lastUpdatedAt"
    FROM agent_performance
    ORDER BY accuracy_pct DESC, agent_name ASC
    LIMIT 200
    `
  );

  return result.rows;
}

export interface AgentCostReport {
  window: ReportingWindow;
  totals: Record<string, unknown>;
  byMarket: Array<Record<string, unknown>>;
}

export async function getAgentCostReport(
  client: Client,
  window: ReportingWindow
): Promise<AgentCostReport> {
  const params = [window.from, window.to];

  const [totals, byMarket] = await Promise.all([
    client.query(
      `
      SELECT
        count(*)::int AS "executions",
        count(DISTINCT market_id)::int AS "markets",
        coalesce(sum(model_costs_usd), 0)::float8 AS "totalCostUsd",
        avg(model_costs_usd)::float8 AS "avgCostUsd",
        avg(total_llm_calls)::float8 AS "avgLlmCalls",
        avg(execution_duration_ms)::float8 AS "avgDurationMs"
      FROM analysis_results
      WHERE executed_at >= $1::timestamptz AND executed_at < $2::timestamptz
      `,
      params
    ),
    client.query(
      `
      SELECT
        r.market_id        AS "marketId",
        m.question         AS "marketQuestion",
        count(*)::int      AS "executions",
        coalesce(sum(r.model_costs_usd), 0)::float8 AS "costUsd",
        avg(r.execution_duration_ms)::float8 AS "avgDurationMs"
      FROM analysis_results r
      LEFT JOIN markets m ON m.condition_id = r.market_id
      WHERE r.executed_at >= $1::timestamptz AND r.executed_at < $2::timestamptz
      GROUP BY r.market_id, m.question
      ORDER BY 4 DESC
      LIMIT 25
      `,
      params
    ),
  ]);

  return {
    window,
    totals: totals.rows[0] ?? {},
    byMarket: byMarket.rows,
  };
}
