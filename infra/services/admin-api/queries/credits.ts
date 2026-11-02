/**
 * Admin credit adjustments.
 *
 * Deliberately separate from `shared/credits.ts`: that module serves the product
 * paths (plan allowances, purchases, refunds). An admin grant is a different
 * operation with its own `credit_source` values, and it must be recorded against
 * an audit row.
 *
 * Every function here expects to run inside a transaction that has already
 * locked the subscription row.
 */

import type { Client } from 'pg';

export interface SubscriptionBalance {
  creditsRemaining: number;
  creditsMonthlyLimit: number;
  plan: string;
}

/** Lock the subscription so concurrent grants cannot interleave. */
export async function lockSubscription(
  client: Client,
  userId: string
): Promise<SubscriptionBalance | null> {
  const result = await client.query(
    `
    SELECT
      credits_remaining::int     AS "creditsRemaining",
      credits_monthly_limit::int AS "creditsMonthlyLimit",
      plan
    FROM subscriptions
    WHERE user_id = $1
    FOR UPDATE
    `,
    [userId]
  );

  return (result.rows[0] as SubscriptionBalance | undefined) ?? null;
}

/**
 * Add credits and record the ledger entry.
 *
 * `credit_source` is `admin_grant` so support can tell an operator adjustment
 * apart from a plan allowance or a purchase in the same ledger.
 */
export async function addCredits(
  client: Client,
  params: {
    userId: string;
    amount: number;
    auditId: string;
    reason: string;
  }
): Promise<number> {
  const updated = await client.query(
    `
    UPDATE subscriptions
    SET credits_remaining = credits_remaining + $2,
        updated_at = now()
    WHERE user_id = $1
    RETURNING credits_remaining::int AS "creditsRemaining"
    `,
    [params.userId, params.amount]
  );

  const balanceAfter: number = updated.rows[0].creditsRemaining;

  await client.query(
    `
    INSERT INTO credit_transactions (
      user_id, amount, balance_after, reason, reference_type, reference_id, credit_source
    ) VALUES ($1, $2, $3, $4, 'admin_audit', $5, 'admin_grant')
    `,
    [params.userId, params.amount, balanceAfter, params.reason, params.auditId]
  );

  return balanceAfter;
}

export interface RefundOutcome {
  refunded: number;
  skipped: number;
  totalRecipients: number;
}

/**
 * Refund one credit to every user who received a given analysis result.
 *
 * Mirrors the product's failure-refund pattern (`analysis_failure_refund`) but
 * uses a distinct reason, because an operator decision is not a failure. The
 * partial unique index on (user_id, reference_id) WHERE reason='admin_refund'
 * makes the operation idempotent: re-running refunds nobody twice.
 */
export async function refundResultDeliveries(
  client: Client,
  resultId: string,
  actorEmail: string
): Promise<RefundOutcome> {
  const recipients = await client.query(
    `SELECT DISTINCT user_id AS "userId" FROM analysis_deliveries WHERE result_id = $1`,
    [resultId]
  );

  let refunded = 0;
  let skipped = 0;

  for (const row of recipients.rows) {
    const userId: string = row.userId;

    // Sequential statements, deliberately. A data-modifying CTE is invisible to
    // the outer statement (same snapshot), so an INSERT ... RETURNING followed by
    // an UPDATE in one statement silently updates nothing.
    const inserted = await client.query(
      `
      INSERT INTO credit_transactions (
        user_id, amount, balance_after, reason, reference_id, reference_type, credit_source
      ) VALUES ($1, 1, 0, 'admin_refund', $2::uuid, 'refund', 'admin_refund')
      ON CONFLICT (user_id, reference_id) WHERE reason = 'admin_refund' DO NOTHING
      RETURNING id
      `,
      [userId, resultId]
    );

    if (inserted.rows.length === 0) {
      skipped += 1;
      continue;
    }

    const balance = await client.query(
      `
      UPDATE subscriptions
      SET credits_remaining = credits_remaining + 1, updated_at = now()
      WHERE user_id = $1
      RETURNING credits_remaining
      `,
      [userId]
    );

    if (balance.rows.length === 0) {
      // No subscription row: do not leave a ledger entry that claims otherwise.
      await client.query('DELETE FROM credit_transactions WHERE id = $1', [inserted.rows[0].id]);
      skipped += 1;
      continue;
    }

    await client.query('UPDATE credit_transactions SET balance_after = $1 WHERE id = $2', [
      balance.rows[0].credits_remaining,
      inserted.rows[0].id,
    ]);

    refunded += 1;
  }

  console.log(
    `Admin refund for result ${resultId} by ${actorEmail}: ${refunded} refunded, ${skipped} already refunded`
  );

  return { refunded, skipped, totalRecipients: recipients.rowCount ?? 0 };
}
