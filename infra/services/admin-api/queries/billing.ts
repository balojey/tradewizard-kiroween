/**
 * Read queries for billing: the on-chain payment ledger, subscription state,
 * and a bounded revenue/renewal summary.
 */

import type { Client } from 'pg';
import type { Cursor } from '../lib/pagination';
import type { ReportingWindow } from '../lib/window';

export interface PaymentFilters {
  from: string | null;
  to: string | null;
  type: string | null;
}

export interface SubscriptionFilters {
  plan: string | null;
  renewal: string | null;
}

export async function listPayments(
  client: Client,
  filters: PaymentFilters,
  limit: number,
  cursor: Cursor | null
): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    `
    SELECT
      pt.id,
      pt.user_id             AS "userId",
      u.email                AS "userEmail",
      pt.transaction_type    AS "type",
      pt.amount_usdc::float8 AS "amountUsdc",
      pt.tx_hash             AS "txHash",
      pt.plan,
      pt.credit_pack_id      AS "creditPackId",
      pt.credits_added       AS "creditsAdded",
      pt.source_address      AS "sourceAddress",
      pt.created_at          AS "createdAt"
    FROM payment_transactions pt
    LEFT JOIN users u ON u.id = pt.user_id
    WHERE ($1::timestamptz IS NULL OR pt.created_at >= $1::timestamptz)
      AND ($2::timestamptz IS NULL OR pt.created_at < $2::timestamptz)
      AND ($3::text IS NULL OR pt.transaction_type = $3)
      AND (
        $4::timestamptz IS NULL
        OR (pt.created_at, pt.id) < ($4::timestamptz, $5::uuid)
      )
    ORDER BY pt.created_at DESC, pt.id DESC
    LIMIT $6
    `,
    [
      filters.from,
      filters.to,
      filters.type,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      limit + 1,
    ]
  );

  return result.rows;
}

export async function listSubscriptions(
  client: Client,
  filters: SubscriptionFilters,
  limit: number,
  cursor: Cursor | null
): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    `
    SELECT *
    FROM (
      SELECT
        s.id,
        s.user_id                AS "userId",
        u.email                  AS "userEmail",
        s.plan,
        s.status,
        s.credits_remaining      AS "creditsRemaining",
        s.credits_monthly_limit  AS "creditsMonthlyLimit",
        s.billing_cycle_start    AS "billingCycleStart",
        s.billing_cycle_end      AS "billingCycleEnd",
        s.is_trial               AS "isTrial",
        s.trial_end              AS "trialEnd",
        s.grace_period_end       AS "gracePeriodEnd",
        s.renewal_paused_at      AS "renewalPausedAt",
        s.wallet_address         AS "walletAddress",
        s.created_at             AS "createdAt",
        CASE
          WHEN s.renewal_paused_at IS NOT NULL THEN 'paused'
          WHEN s.grace_period_end IS NOT NULL AND s.grace_period_end > now() THEN 'grace'
          WHEN s.status = 'active' AND s.plan <> 'free' AND s.billing_cycle_end < now() THEN 'failing'
          ELSE 'ok'
        END AS "renewalState"
      FROM subscriptions s
      LEFT JOIN users u ON u.id = s.user_id
    ) q
    WHERE ($1::text IS NULL OR q.plan = $1)
      AND ($2::text IS NULL OR q."renewalState" = $2)
      AND (
        $3::timestamptz IS NULL
        OR (q."createdAt", q.id) < ($3::timestamptz, $4::uuid)
      )
    ORDER BY q."createdAt" DESC, q.id DESC
    LIMIT $5
    `,
    [
      filters.plan,
      filters.renewal,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      limit + 1,
    ]
  );

  return result.rows;
}

export interface BillingSummary {
  window: ReportingWindow;
  revenue: Record<string, unknown>;
  byPlan: Array<{ plan: string; count: number }>;
  renewal: Record<string, unknown>;
}

export async function getBillingSummary(
  client: Client,
  window: ReportingWindow
): Promise<BillingSummary> {
  const params = [window.from, window.to];

  const [revenue, byPlan, renewal] = await Promise.all([
    client.query(
      `
      SELECT
        count(*)::int AS "payments",
        coalesce(sum(amount_usdc), 0)::float8 AS "totalUsdc",
        coalesce(sum(amount_usdc) FILTER (
          WHERE transaction_type IN ('subscription_payment', 'renewal_payment')
        ), 0)::float8 AS "subscriptionUsdc",
        coalesce(sum(amount_usdc) FILTER (
          WHERE transaction_type = 'credit_pack_purchase'
        ), 0)::float8 AS "creditPackUsdc",
        count(DISTINCT user_id)::int AS "payers"
      FROM payment_transactions
      WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
      `,
      params
    ),
    client.query(
      `
      SELECT plan, count(*)::int AS count
      FROM subscriptions
      WHERE status = 'active'
      GROUP BY 1
      ORDER BY 2 DESC
      `
    ),
    client.query(
      `
      SELECT
        count(*) FILTER (WHERE status = 'active')::int AS "active",
        count(*) FILTER (WHERE is_trial AND status = 'active')::int AS "trials",
        count(*) FILTER (WHERE grace_period_end IS NOT NULL AND grace_period_end > now())::int AS "inGrace",
        count(*) FILTER (WHERE status = 'active' AND plan <> 'free' AND billing_cycle_end < now())::int AS "pastDue",
        count(*) FILTER (WHERE renewal_paused_at IS NOT NULL)::int AS "paused",
        count(*) FILTER (WHERE status = 'cancelled')::int AS "cancelled"
      FROM subscriptions
      `
    ),
  ]);

  return {
    window,
    revenue: revenue.rows[0] ?? {},
    byPlan: byPlan.rows as Array<{ plan: string; count: number }>,
    renewal: renewal.rows[0] ?? {},
  };
}
