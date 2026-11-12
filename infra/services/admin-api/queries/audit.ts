/**
 * Audit log reads.
 */

import type { Client } from 'pg';
import type { Cursor } from '../lib/pagination';

/**
 * Fetch the audit row for an idempotency key.
 *
 * Used to replay a retried mutation: the unique index guarantees at most one
 * row per (actor, action, key), so a hit means this exact action already ran.
 */
export async function findAuditByKey(
  client: Client,
  actorSub: string,
  action: string,
  idempotencyKey: string
): Promise<Record<string, unknown> | null> {
  const result = await client.query(
    `
    SELECT id, status, after, error, created_at AS "createdAt"
    FROM admin_audit_log
    WHERE actor_sub = $1 AND action = $2 AND idempotency_key = $3
    LIMIT 1
    `,
    [actorSub, action, idempotencyKey]
  );

  return result.rows[0] ?? null;
}

export interface AuditFilters {
  actor: string | null;
  action: string | null;
  targetType: string | null;
  targetId: string | null;
  status: string | null;
  from: string | null;
  to: string | null;
  /** Exact row id, used for deep links from copilot citations. */
  id?: string | null;
}

export async function listAuditEntries(
  client: Client,
  filters: AuditFilters,
  limit: number,
  cursor: Cursor | null
): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    `
    SELECT
      a.id,
      a.actor_sub       AS "actorSub",
      a.actor_email     AS "actorEmail",
      a.actor_role      AS "actorRole",
      a.action,
      a.target_type     AS "targetType",
      a.target_id       AS "targetId",
      a.reason,
      a.status,
      a.error,
      a.before,
      a.after,
      a.request_id      AS "requestId",
      a.created_at      AS "createdAt",
      a.prev_hash       AS "prevHash",
      a.row_hash        AS "rowHash",
      a.completion_hash AS "completionHash",
      a.hash_version    AS "hashVersion",
      a.completed_at    AS "completedAt"
    FROM admin_audit_log a
    WHERE ($1::text IS NULL OR a.actor_sub = $1 OR a.actor_email ILIKE '%' || $1 || '%')
      AND ($2::text IS NULL OR a.action = $2)
      AND ($3::text IS NULL OR a.target_type = $3)
      AND ($4::text IS NULL OR a.target_id = $4)
      AND ($5::text IS NULL OR a.status = $5)
      AND ($6::timestamptz IS NULL OR a.created_at >= $6::timestamptz)
      AND ($7::timestamptz IS NULL OR a.created_at < $7::timestamptz)
      AND ($8::uuid IS NULL OR a.id = $8::uuid)
      AND (
        $9::timestamptz IS NULL
        OR (a.created_at, a.id) < ($9::timestamptz, $10::uuid)
      )
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT $11
    `,
    [
      filters.actor,
      filters.action,
      filters.targetType,
      filters.targetId,
      filters.status,
      filters.from,
      filters.to,
      filters.id ?? null,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      limit + 1,
    ]
  );

  return result.rows;
}

/**
 * Rows for a chain verification, ascending `(created_at, id)` order.
 *
 * Bounded by `limit` and read newest-first, because "the last N rows" is the
 * question an operator actually asks; unbounded verification would be an
 * accidental full-table scan on every click.
 */
export async function listAuditChain(
  client: Client,
  filters: { from: string | null; to: string | null; limit: number }
): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    `
    SELECT
      a.id,
      a.actor_sub       AS "actorSub",
      a.actor_email     AS "actorEmail",
      a.actor_role      AS "actorRole",
      a.action,
      a.target_type     AS "targetType",
      a.target_id       AS "targetId",
      a.reason,
      a.status,
      a.before,
      a.after,
      a.error,
      a.created_at      AS "createdAt",
      a.completed_at    AS "completedAt",
      a.prev_hash       AS "prevHash",
      a.row_hash        AS "rowHash",
      a.completion_hash AS "completionHash",
      a.hash_version    AS "hashVersion"
    FROM admin_audit_log a
    WHERE ($1::timestamptz IS NULL OR a.created_at >= $1::timestamptz)
      AND ($2::timestamptz IS NULL OR a.created_at < $2::timestamptz)
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT $3
    `,
    [filters.from, filters.to, filters.limit]
  );

  // The chain is verified oldest-first; the query reads newest-first so the
  // bound selects the most recent rows rather than the oldest.
  return result.rows.reverse();
}

/**
 * Does the log contain a row before `id`? If not, the verification window
 * starts at genesis and the first row's `prev_hash` must be null.
 *
 * The comparison uses the stored row's own `(created_at, id)`, not the
 * millisecond-truncated value read into JS: legacy rows have microsecond
 * timestamps, and comparing against a rounded one would place a phantom row
 * before the first row of the log.
 */
export async function hasEarlierAuditRow(client: Client, id: string): Promise<boolean> {
  const result = await client.query(
    `
    SELECT 1
    FROM admin_audit_log a
    WHERE (a.created_at, a.id) < (
      SELECT p.created_at, p.id FROM admin_audit_log p WHERE p.id = $1
    )
    LIMIT 1
    `,
    [id]
  );

  return result.rows.length > 0;
}
