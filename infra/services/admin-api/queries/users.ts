/**
 * Read queries for the users domain.
 *
 * Rules (docs/admin-portal-architecture.md §7.5):
 * - column lists are explicit, never `SELECT *`
 * - every list is bounded by `LIMIT` and keyset-paginated
 * - numerics are cast to float8 so the API emits numbers, not strings
 * - snake_case is aliased to camelCase in SQL to keep the route layer thin
 */

import type { Client } from 'pg';
import type { Cursor } from '../lib/pagination';

export interface UserListFilters {
  q: string | null;
  plan: string | null;
  status: string | null;
  hasPm: boolean;
}

const USER_SUMMARY_COLUMNS = `
  u.id,
  u.email,
  u.display_name        AS "displayName",
  u.status,
  u.created_at          AS "createdAt",
  s.plan,
  s.status              AS "subscriptionStatus",
  s.credits_remaining   AS "creditsRemaining",
  s.credits_monthly_limit AS "creditsMonthlyLimit",
  s.billing_cycle_end   AS "billingCycleEnd"
`;

/**
 * Keyset predicate.
 *
 * Both parameters are always referenced, even when the cursor is null. A
 * conditionally-referenced parameter leaves PostgreSQL unable to infer its type
 * ("could not determine data type of parameter $n"), which fails at runtime.
 */
function cursorClause(
  alias: string,
  column: string,
  createdAtParam: number,
  idParam: number
): string {
  return `(
    $${createdAtParam}::timestamptz IS NULL
    OR (${alias}.${column}, ${alias}.id) < ($${createdAtParam}::timestamptz, $${idParam}::uuid)
  )`;
}

function cursorParams(cursor: Cursor | null): [string | null, string | null] {
  return [cursor?.createdAt ?? null, cursor?.id ?? null];
}

export async function listUsers(
  client: Client,
  filters: UserListFilters,
  limit: number,
  cursor: Cursor | null
): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    `
    SELECT ${USER_SUMMARY_COLUMNS}
    FROM users u
    LEFT JOIN subscriptions s ON s.user_id = u.id
    WHERE ($1::text IS NULL OR u.email ILIKE '%' || $1 || '%' OR u.display_name ILIKE '%' || $1 || '%')
      AND ($2::text IS NULL OR s.plan = $2)
      AND ($3::text IS NULL OR u.status = $3)
      AND ($4::boolean = false OR EXISTS (
        SELECT 1 FROM portfolio_manager_sessions p
        WHERE p.user_id = u.id AND p.status IN ('active', 'paused', 'exiting')
      ))
      AND ${cursorClause('u', 'created_at', 5, 6)}
    ORDER BY u.created_at DESC, u.id DESC
    LIMIT $7
    `,
    [filters.q, filters.plan, filters.status, filters.hasPm, ...cursorParams(cursor), limit + 1]
  );

  return result.rows;
}

export async function getUserById(
  client: Client,
  userId: string
): Promise<Record<string, unknown> | null> {
  const result = await client.query(
    `
    SELECT
      u.id,
      u.email,
      u.display_name          AS "displayName",
      u.status,
      u.cognito_sub           AS "cognitoSub",
      u.portfolio_persona_id  AS "portfolioPersonaId",
      u.portfolio_persona_params AS "portfolioPersonaParams",
      u.has_used_paid_plan    AS "hasUsedPaidPlan",
      u.created_at            AS "createdAt",
      u.updated_at            AS "updatedAt",
      s.plan,
      s.status                AS "subscriptionStatus",
      s.credits_remaining     AS "creditsRemaining",
      s.credits_monthly_limit AS "creditsMonthlyLimit",
      s.billing_cycle_start   AS "billingCycleStart",
      s.billing_cycle_end     AS "billingCycleEnd",
      s.is_trial              AS "isTrial",
      s.trial_end             AS "trialEnd",
      s.wallet_address        AS "walletAddress",
      s.renewal_paused_at     AS "renewalPausedAt",
      o.plan                  AS "overridePlan",
      o.previous_plan         AS "overridePreviousPlan",
      o.expires_at            AS "overrideExpiresAt",
      (SELECT count(*) FROM analysis_deliveries d WHERE d.user_id = u.id)      AS "analysesDelivered",
      (SELECT count(*) FROM portfolio_manager_sessions p WHERE p.user_id = u.id) AS "sessionsTotal",
      (SELECT count(*) FROM payment_transactions pt WHERE pt.user_id = u.id)   AS "paymentsTotal",
      (SELECT coalesce(sum(pt.amount_usdc), 0)::float8
         FROM payment_transactions pt WHERE pt.user_id = u.id)                 AS "lifetimeUsdc"
    FROM users u
    LEFT JOIN subscriptions s ON s.user_id = u.id
    LEFT JOIN admin_plan_overrides o ON o.user_id = u.id AND o.revoked_at IS NULL
    WHERE u.id = $1
    LIMIT 1
    `,
    [userId]
  );

  return result.rows[0] ?? null;
}

export async function listUserCredits(
  client: Client,
  userId: string,
  limit: number,
  cursor: Cursor | null
): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    `
    SELECT
      ct.id,
      ct.amount,
      ct.balance_after   AS "balanceAfter",
      ct.reason,
      ct.reference_type  AS "referenceType",
      ct.reference_id    AS "referenceId",
      ct.credit_source   AS "creditSource",
      ct.created_at      AS "createdAt"
    FROM credit_transactions ct
    WHERE ct.user_id = $1
      AND ${cursorClause('ct', 'created_at', 2, 3)}
    ORDER BY ct.created_at DESC, ct.id DESC
    LIMIT $4
    `,
    [userId, ...cursorParams(cursor), limit + 1]
  );

  return result.rows;
}

export async function listUserAnalyses(
  client: Client,
  userId: string,
  limit: number,
  cursor: Cursor | null
): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    `
    SELECT
      d.id               AS "deliveryId",
      d.delivered_at     AS "deliveredAt",
      d.was_cached_delivery AS "wasCached",
      d.delivery_channel AS "channel",
      r.id               AS "resultId",
      r.market_id        AS "marketId",
      m.question         AS "marketQuestion",
      r.recommendation,
      r.consensus_probability::float8 AS "consensusProbability",
      r.confidence_score::float8      AS "confidence",
      r.outcome_status   AS "outcomeStatus"
    FROM analysis_deliveries d
    JOIN analysis_results r ON r.id = d.result_id
    LEFT JOIN markets m ON m.condition_id = r.market_id
    WHERE d.user_id = $1
      AND ${cursorClause('d', 'delivered_at', 2, 3)}
    ORDER BY d.delivered_at DESC, d.id DESC
    LIMIT $4
    `,
    [userId, ...cursorParams(cursor), limit + 1]
  );

  return result.rows;
}

export async function listUserSessions(
  client: Client,
  userId: string,
  limit: number,
  cursor: Cursor | null
): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    `
    SELECT
      p.id,
      p.market_id          AS "marketId",
      p.persona_id         AS "personaId",
      p.investment_amount::float8 AS "investmentAmount",
      p.status,
      p.position_direction AS "positionDirection",
      p.total_trades       AS "totalTrades",
      p.winning_trades     AS "winningTrades",
      p.realized_pnl::float8   AS "realizedPnl",
      p.unrealized_pnl::float8 AS "unrealizedPnl",
      p.amount_available::float8 AS "amountAvailable",
      p.termination_reason AS "terminationReason",
      p.created_at         AS "createdAt",
      p.terminated_at      AS "terminatedAt"
    FROM portfolio_manager_sessions p
    WHERE p.user_id = $1
      AND ${cursorClause('p', 'created_at', 2, 3)}
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT $4
    `,
    [userId, ...cursorParams(cursor), limit + 1]
  );

  return result.rows;
}

export async function listUserPayments(
  client: Client,
  userId: string,
  limit: number,
  cursor: Cursor | null
): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    `
    SELECT
      pt.id,
      pt.transaction_type AS "transactionType",
      pt.amount_usdc::float8 AS "amountUsdc",
      pt.tx_hash          AS "txHash",
      pt.plan,
      pt.credit_pack_id   AS "creditPackId",
      pt.credits_added    AS "creditsAdded",
      pt.created_at       AS "createdAt"
    FROM payment_transactions pt
    WHERE pt.user_id = $1
      AND ${cursorClause('pt', 'created_at', 2, 3)}
    ORDER BY pt.created_at DESC, pt.id DESC
    LIMIT $4
    `,
    [userId, ...cursorParams(cursor), limit + 1]
  );

  return result.rows;
}

export async function listUserNotes(
  client: Client,
  userId: string,
  limit: number,
  cursor: Cursor | null
): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    `
    SELECT
      n.id,
      n.author_email AS "authorEmail",
      n.body,
      n.created_at   AS "createdAt"
    FROM admin_user_notes n
    WHERE n.user_id = $1
      AND ${cursorClause('n', 'created_at', 2, 3)}
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT $4
    `,
    [userId, ...cursorParams(cursor), limit + 1]
  );

  return result.rows;
}

/** Cheap existence check used to 404 sub-resource lists for unknown users. */
export async function userExists(client: Client, userId: string): Promise<boolean> {
  const result = await client.query('SELECT 1 FROM users WHERE id = $1 LIMIT 1', [userId]);
  return (result.rowCount ?? 0) > 0;
}
