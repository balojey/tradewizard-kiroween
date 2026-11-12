/**
 * Audit retrieval.
 *
 * One parameterised query, a hard LIMIT, and an explicit time bound. Search is
 * Postgres full-text over the four columns an operator actually reasons about.
 * There is no way to ask this module for an unbounded scan.
 *
 * See docs/plans/warden-ai-copilot.md §5.
 */

import type { Client } from 'pg';
import type { AdminRole } from '../../shared/admin-auth';
import { sanitizeUntrustedText, safeStringify } from './redact';
import type { RetrievedRecord } from '../types';

export const AUDIT_LIMIT = 50;

export interface AuditRetrievalOptions {
  role: AdminRole;
  from: string;
  to: string;
  /** Exact action name, e.g. `settings.update`. */
  action?: string | null;
  /** Free-text search; bound as a parameter, never concatenated. */
  search?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  limit?: number;
}

interface AuditRow {
  id: string;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  reason: string | null;
  status: string;
  error: string | null;
  before: unknown;
  after: unknown;
  createdAt: Date | string;
}

export async function retrieveAudit(
  client: Client,
  options: AuditRetrievalOptions
): Promise<RetrievedRecord[]> {
  const limit = Math.min(Math.max(options.limit ?? AUDIT_LIMIT, 1), AUDIT_LIMIT);
  const search = normalizeSearch(options.search);

  const result = await client.query<AuditRow>(
    `
    SELECT
      a.id,
      a.actor_email AS "actorEmail",
      a.actor_role  AS "actorRole",
      a.action,
      a.target_type AS "targetType",
      a.target_id   AS "targetId",
      a.reason,
      a.status,
      a.error,
      a.before,
      a.after,
      a.created_at  AS "createdAt"
    FROM admin_audit_log a
    WHERE a.created_at >= $1::timestamptz
      AND a.created_at <  $2::timestamptz
      AND ($3::text IS NULL OR a.target_type = $3)
      AND ($4::text IS NULL OR a.target_id = $4)
      AND ($5::text IS NULL OR a.action = $5)
      AND (
        $6::text IS NULL
        OR to_tsvector(
             'english',
             coalesce(a.action, '') || ' ' ||
             coalesce(a.reason, '') || ' ' ||
             coalesce(a.target_type, '') || ' ' ||
             coalesce(a.target_id, '')
           ) @@ plainto_tsquery('english', $6)
        OR a.target_id = $6
      )
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT $7
    `,
    [
      options.from,
      options.to,
      options.targetType ?? null,
      options.targetId ?? null,
      options.action ?? null,
      search,
      limit,
    ]
  );

  return result.rows.map((row) => toRecord(row, options.role));
}

function toRecord(row: AuditRow, role: AdminRole): RetrievedRecord {
  const createdAt =
    row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt);

  const before = safeStringify(row.before, 600);
  const after = safeStringify(row.after, 600);

  return {
    type: 'audit',
    id: row.id,
    label: `${row.action} by ${row.actorEmail ?? 'unknown actor'}`,
    // Deep link to this exact audit row; the page accepts an `id` filter.
    url: `/audit?id=${encodeURIComponent(row.id)}`,
    at: createdAt,
    data: {
      createdAt,
      action: row.action,
      actorEmail: sanitizeUntrustedText(row.actorEmail, role, 200),
      actorRole: row.actorRole,
      targetType: row.targetType,
      targetId: row.targetId,
      reason: sanitizeUntrustedText(row.reason, role, 400),
      status: row.status,
      error: sanitizeUntrustedText(row.error, role, 300),
      before: before ? sanitizeUntrustedText(before, role, 600) : null,
      after: after ? sanitizeUntrustedText(after, role, 600) : null,
    },
  };
}

/** Keep the full-text query short and free of operators the parser dislikes. */
function normalizeSearch(value: string | null | undefined): string | null {
  if (!value) return null;

  const cleaned = value
    .replace(/[^\p{L}\p{N}\s._:-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

  return cleaned.length >= 2 ? cleaned : null;
}
