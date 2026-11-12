/**
 * Plan overrides (comped plans).
 *
 * Model: an override **applies** the plan to the subscription, rather than
 * layering a resolution rule on top of it. Every product path already reads
 * `subscriptions.plan`, so applying it there makes the comp effective
 * immediately and everywhere, with no changes to billing or credit code.
 *
 * The override row is the record of *why* the plan differs, and it holds the
 * plan to restore. Renewal is paused while an override is active, otherwise the
 * renewal job would overwrite the comp at the next cycle.
 */

import type { Client } from 'pg';
import { insertChainedAuditRow } from './audit-chain';

export interface PlanOverride {
  userId: string;
  plan: string;
  previousPlan: string | null;
  expiresAt: string | null;
  reason: string;
  grantedBy: string;
  createdAt: string;
}

export async function getActiveOverride(
  client: Client,
  userId: string
): Promise<PlanOverride | null> {
  const result = await client.query(
    `
    SELECT
      user_id       AS "userId",
      plan,
      previous_plan AS "previousPlan",
      expires_at    AS "expiresAt",
      reason,
      granted_by    AS "grantedBy",
      created_at    AS "createdAt"
    FROM admin_plan_overrides
    WHERE user_id = $1
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1
    `,
    [userId]
  );

  return (result.rows[0] as PlanOverride | undefined) ?? null;
}

/**
 * Apply a comped plan. Caller supplies the transaction and the audit id.
 */
export async function grantOverride(
  client: Client,
  params: {
    userId: string;
    plan: string;
    expiresAt: string | null;
    reason: string;
    grantedBy: string;
    currentPlan: string;
    hadActiveOverride: boolean;
  }
): Promise<void> {
  // Preserve the original plan across repeated grants: re-comping an already
  // comped account must not overwrite what to restore with the comp itself.
  const previousPlan = params.hadActiveOverride
    ? (
        await client.query(
          'SELECT previous_plan FROM admin_plan_overrides WHERE user_id = $1 LIMIT 1',
          [params.userId]
        )
      ).rows[0]?.previous_plan ?? params.currentPlan
    : params.currentPlan;

  await client.query(
    `
    INSERT INTO admin_plan_overrides (
      user_id, plan, previous_plan, expires_at, reason, granted_by, revoked_at, created_at
    ) VALUES ($1, $2, $3, $4::timestamptz, $5, $6, NULL, now())
    ON CONFLICT (user_id) DO UPDATE SET
      plan = EXCLUDED.plan,
      previous_plan = EXCLUDED.previous_plan,
      expires_at = EXCLUDED.expires_at,
      reason = EXCLUDED.reason,
      granted_by = EXCLUDED.granted_by,
      revoked_at = NULL,
      created_at = now()
    `,
    [params.userId, params.plan, previousPlan, params.expiresAt, params.reason, params.grantedBy]
  );

  await client.query(
    `UPDATE subscriptions SET plan = $2, renewal_paused_at = now(), updated_at = now()
     WHERE user_id = $1`,
    [params.userId, params.plan]
  );
}

/** Restore the plan that was in place before the comp. */
export async function revokeOverride(
  client: Client,
  userId: string
): Promise<{ restoredPlan: string | null }> {
  const current = await client.query(
    `
    UPDATE admin_plan_overrides
    SET revoked_at = now()
    WHERE user_id = $1 AND revoked_at IS NULL
    RETURNING previous_plan AS "previousPlan"
    `,
    [userId]
  );

  const restoredPlan: string | null = current.rows[0]?.previousPlan ?? null;

  if (restoredPlan) {
    await client.query(
      `UPDATE subscriptions SET plan = $2, renewal_paused_at = NULL, updated_at = now()
       WHERE user_id = $1`,
      [userId, restoredPlan]
    );
  }

  return { restoredPlan };
}

/**
 * Expire comps whose time is up.
 *
 * Run by the hourly maintenance job. Uses `FOR UPDATE SKIP LOCKED` so two
 * concurrent runs cannot both restore the same row.
 */
export async function expireOverrides(
  client: Client
): Promise<Array<{ userId: string; restoredPlan: string | null }>> {
  const expired = await client.query(
    `
    SELECT user_id AS "userId", previous_plan AS "previousPlan"
    FROM admin_plan_overrides
    WHERE revoked_at IS NULL
      AND expires_at IS NOT NULL
      AND expires_at <= now()
    FOR UPDATE SKIP LOCKED
    `
  );

  const results: Array<{ userId: string; restoredPlan: string | null }> = [];

  for (const row of expired.rows) {
    const userId: string = row.userId;

    await client.query(
      'UPDATE admin_plan_overrides SET revoked_at = now() WHERE user_id = $1',
      [userId]
    );

    if (row.previousPlan) {
      await client.query(
        `UPDATE subscriptions SET plan = $2, renewal_paused_at = NULL, updated_at = now()
         WHERE user_id = $1`,
        [userId, row.previousPlan]
      );
    }

    // A plan change is a governance event even when nobody clicked anything.
    // Inserted through the chained writer like every other row: a raw insert
    // would have no `row_hash` and break verification at that point.
    await insertChainedAuditRow(client, {
      actorSub: 'system',
      actorEmail: 'system',
      actorRole: 'system',
      action: 'user.plan.override.expire',
      targetType: 'user',
      targetId: userId,
      reason: 'Comp window elapsed',
      status: 'succeeded',
      before: { plan: row.previousPlan ?? null },
      after: { restoredPlan: row.previousPlan ?? null },
    });

    results.push({ userId, restoredPlan: row.previousPlan ?? null });
  }

  return results;
}
