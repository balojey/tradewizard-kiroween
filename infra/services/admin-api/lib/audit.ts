/**
 * Audit log: the governance record for every admin mutation.
 *
 * Contract (docs/admin-portal-architecture.md §7.3):
 * - `writeAuditLog` inserts a `pending` row **before** the action runs and
 *   returns its id. It commits independently, so a failure afterwards still
 *   leaves evidence that the action was attempted.
 * - `completeAudit` marks that row `succeeded` or `failed`. It is the only
 *   permitted update; a trigger in the database rejects everything else.
 *
 * Reads never go through here — the audit route queries the table directly.
 */

import type { Client } from 'pg';
import type { AdminIdentity } from '../../shared/admin-auth';

export interface AuditWriteParams {
  actor: AdminIdentity;
  /** Dotted verb, e.g. `user.credits.grant`. Keep the vocabulary closed. */
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string;
  before?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  idempotencyKey?: string | null;
}

export async function writeAuditLog(client: Client, params: AuditWriteParams): Promise<string> {
  const result = await client.query(
    `
    INSERT INTO admin_audit_log (
      actor_sub, actor_email, actor_role, action, target_type, target_id,
      reason, status, before, ip, user_agent, request_id, idempotency_key
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8::jsonb, $9, $10, $11, $12)
    RETURNING id
    `,
    [
      params.actor.sub,
      params.actor.email,
      params.actor.role,
      params.action,
      params.targetType,
      params.targetId,
      params.reason,
      params.before === undefined ? null : JSON.stringify(params.before),
      params.ip ?? null,
      params.userAgent ?? null,
      params.requestId ?? null,
      params.idempotencyKey ?? null,
    ]
  );

  return String(result.rows[0].id);
}

export interface AuditCompletion {
  status: 'succeeded' | 'failed';
  after?: Record<string, unknown> | null;
  error?: string | null;
}

export async function completeAudit(
  client: Client,
  auditId: string,
  completion: AuditCompletion
): Promise<void> {
  await client.query(
    `
    UPDATE admin_audit_log
    SET status = $2,
        after = $3::jsonb,
        error = $4
    WHERE id = $1 AND status = 'pending'
    `,
    [
      auditId,
      completion.status,
      completion.after === undefined ? null : JSON.stringify(completion.after),
      completion.error ?? null,
    ]
  );
}

/**
 * Run a mutation under the audit contract.
 *
 * The audit row is written and committed first; the work then runs in its own
 * transaction. If the work throws, the audit row is completed as `failed` and
 * the error is rethrown — callers return a 500, never a silent success.
 */
export async function withAudit<T>(
  client: Client,
  params: AuditWriteParams,
  work: (auditId: string) => Promise<{ result: T; after?: Record<string, unknown> }>
): Promise<T> {
  const auditId = await writeAuditLog(client, params);

  try {
    const { result, after } = await work(auditId);
    await completeAudit(client, auditId, { status: 'succeeded', after: after ?? null });
    return result;
  } catch (error) {
    await completeAudit(client, auditId, {
      status: 'failed',
      error: (error as Error).message,
    }).catch(() => undefined);
    throw error;
  }
}
