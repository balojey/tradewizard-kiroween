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
 * Integrity: every row is linked to the previous one by a SHA-256 hash. The
 * insert takes a transaction-scoped advisory lock, reads the head, and writes
 * `prev_hash`/`row_hash` in one statement (see services/shared/audit-chain.ts).
 * If the chain write fails, the mutation fails: never execute an unauditable
 * action.
 *
 * Reads never go through here — the audit route queries the table directly.
 */

import type { Client } from 'pg';
import type { AdminIdentity } from '../../shared/admin-auth';
import {
  canonicalJson,
  computeCompletionHash,
  insertChainedAuditRow,
} from '../../shared/audit-chain';

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

export async function writeAuditLog(
  client: Client,
  params: AuditWriteParams,
  options: { inTransaction?: boolean } = {}
): Promise<string> {
  const { id } = await insertChainedAuditRow(
    client,
    {
      actorSub: params.actor.sub,
      actorEmail: params.actor.email,
      actorRole: params.actor.role,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      reason: params.reason,
      status: 'pending',
      before: params.before ?? null,
      ip: params.ip ?? null,
      userAgent: params.userAgent ?? null,
      requestId: params.requestId ?? null,
      idempotencyKey: params.idempotencyKey ?? null,
    },
    options
  );

  return id;
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
  // The completion hash commits to the row hash, so the row must already carry
  // one. A missing hash means the row predates the chain and the backfill has
  // not run; refuse rather than write a completion that cannot be verified.
  const current = await client.query<{ rowHash: string | null }>(
    'SELECT row_hash AS "rowHash" FROM admin_audit_log WHERE id = $1',
    [auditId]
  );

  const rowHash = current.rows[0]?.rowHash;

  if (!rowHash) {
    throw new Error(
      `Audit row ${auditId} has no row_hash; run scripts/backfill-audit-chain.ts before completing it`
    );
  }

  const after = completion.after ?? null;
  const error = completion.error ?? null;
  const completedAt = new Date().toISOString();

  const completionHash = computeCompletionHash({
    rowHash,
    status: completion.status,
    after,
    error,
    completedAt,
  });

  await client.query(
    `
    UPDATE admin_audit_log
    SET status = $2,
        after = $3::jsonb,
        error = $4,
        completion_hash = $5,
        completed_at = $6::timestamptz
    WHERE id = $1 AND status = 'pending'
    `,
    [
      auditId,
      completion.status,
      after === null ? null : canonicalJson(after),
      error,
      completionHash,
      completedAt,
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
