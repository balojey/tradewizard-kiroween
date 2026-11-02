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
      a.created_at      AS "createdAt"
    FROM admin_audit_log a
    WHERE ($1::text IS NULL OR a.actor_sub = $1 OR a.actor_email ILIKE '%' || $1 || '%')
      AND ($2::text IS NULL OR a.action = $2)
      AND ($3::text IS NULL OR a.target_type = $3)
      AND ($4::text IS NULL OR a.target_id = $4)
      AND ($5::text IS NULL OR a.status = $5)
      AND ($6::timestamptz IS NULL OR a.created_at >= $6::timestamptz)
      AND ($7::timestamptz IS NULL OR a.created_at < $7::timestamptz)
      AND (
        $8::timestamptz IS NULL
        OR (a.created_at, a.id) < ($8::timestamptz, $9::uuid)
      )
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT $10
    `,
    [
      filters.actor,
      filters.action,
      filters.targetType,
      filters.targetId,
      filters.status,
      filters.from,
      filters.to,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      limit + 1,
    ]
  );

  return result.rows;
}
