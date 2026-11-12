/**
 * Audit routes.
 *
 * The viewer is read-only by construction: there is no update or delete path,
 * and the database trigger rejects both. Verification and export are reads too
 * — a broken chain is a finding, so verification answers 200 with `valid:
 * false` rather than a server error.
 */

import { withClient } from '../lib/db';
import { parsePagination, toPage } from '../lib/pagination';
import { HttpError, json } from '../lib/responses';
import { parseOptionalDate } from '../lib/window';
import type { AdminRoute, RouteContext } from '../lib/router';
import {
  hasEarlierAuditRow,
  listAuditChain,
  listAuditEntries,
  type AuditFilters,
} from '../queries/audit';
import { verifyAuditChain, type VerificationRow } from '../lib/audit-chain';

const STATUSES = ['pending', 'succeeded', 'failed'];

/** Verify a bounded window by default; a full-table walk is never implicit. */
const VERIFY_DEFAULT_LIMIT = 1_000;
const VERIFY_MAX_LIMIT = 5_000;

/** Export is capped for the same reason: no unbounded query on this database. */
const EXPORT_MAX = 5_000;

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function isoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}

function parseFilters(params: Record<string, string>): AuditFilters {
  if (params.status && !STATUSES.includes(params.status)) {
    throw new HttpError(400, 'BAD_REQUEST', `Invalid status: ${params.status}`);
  }

  const from = parseOptionalDate(params.from, 'from');
  const to = parseOptionalDate(params.to, 'to');

  if (from && to && new Date(from) >= new Date(to)) {
    throw new HttpError(400, 'BAD_REQUEST', '"from" must be before "to"');
  }

  return {
    actor: params.actor?.trim() || null,
    action: params.action?.trim() || null,
    targetType: params.targetType?.trim() || null,
    targetId: params.targetId?.trim() || null,
    status: params.status ?? null,
    from,
    to,
  };
}

function parseLimit(raw: string | undefined, fallback: number, max: number): number {
  if (!raw || !raw.trim()) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, 'BAD_REQUEST', `Invalid limit: ${raw}`);
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), max);
}

function toVerificationRow(row: Record<string, unknown>): VerificationRow {
  return {
    id: String(row.id),
    actorSub: String(row.actorSub),
    actorEmail: String(row.actorEmail),
    actorRole: String(row.actorRole),
    action: String(row.action),
    targetType: String(row.targetType),
    targetId: (row.targetId as string | null) ?? null,
    reason: String(row.reason),
    before: row.before ?? null,
    createdAt: iso(row.createdAt),
    prevHash: (row.prevHash as string | null) ?? null,
    rowHash: (row.rowHash as string | null) ?? null,
    hashVersion: Number(row.hashVersion ?? 1),
    status: row.status as VerificationRow['status'],
    after: row.after ?? null,
    error: (row.error as string | null) ?? null,
    completionHash: (row.completionHash as string | null) ?? null,
    completedAt: isoOrNull(row.completedAt),
  };
}

export const auditRoutes: AdminRoute[] = [
  {
    method: 'GET',
    path: '/admin/audit',
    minimumRole: 'analyst',
    handler: async ({ event }: RouteContext) => {
      const params = event.queryStringParameters ?? {};
      const { limit, cursor } = parsePagination(params);
      const filters = parseFilters(params);

      return withClient(async (client) => {
        const rows = await listAuditEntries(client, filters, limit, cursor);
        const page = toPage(rows, limit, (row) => ({
          createdAt: iso(row.createdAt),
          id: String(row.id),
        }));

        return json(event, 200, page.items, { nextCursor: page.nextCursor });
      });
    },
  },
  {
    method: 'GET',
    path: '/admin/audit/verify',
    minimumRole: 'analyst',
    handler: async ({ event }: RouteContext) => {
      const params = event.queryStringParameters ?? {};
      const limit = parseLimit(params.limit, VERIFY_DEFAULT_LIMIT, VERIFY_MAX_LIMIT);
      const { from, to } = parseFilters(params);

      return withClient(async (client) => {
        const rows = await listAuditChain(client, { from, to, limit });
        const chain = rows.map(toVerificationRow);

        // Only the first row of the window has an unverifiable predecessor;
        // if no earlier row exists, it is the genesis row and must start clean.
        const first = chain[0];
        const coversGenesis = first ? !(await hasEarlierAuditRow(client, first.id)) : true;

        const result = verifyAuditChain(chain, { coversGenesis });

        return json(event, 200, {
          valid: result.valid,
          checked: result.checked,
          from: chain[0]?.createdAt ?? null,
          to: chain[chain.length - 1]?.createdAt ?? null,
          head: result.head,
          firstBrokenId: result.firstBrokenId,
          firstBrokenReason: result.firstBrokenReason,
          coversGenesis: result.coversGenesis,
          limit,
          verifiedAt: new Date().toISOString(),
        });
      });
    },
  },
  {
    method: 'GET',
    path: '/admin/audit/export',
    minimumRole: 'analyst',
    handler: async ({ event }: RouteContext) => {
      const params = event.queryStringParameters ?? {};
      const filters = parseFilters(params);

      return withClient(async (client) => {
        // One sentinel row tells us whether the cap truncated the result.
        const rows = await listAuditEntries(client, filters, EXPORT_MAX, null);
        const truncated = rows.length > EXPORT_MAX;

        return json(event, 200, {
          rows: rows.slice(0, EXPORT_MAX),
          truncated,
          cappedAt: EXPORT_MAX,
          exportedAt: new Date().toISOString(),
        });
      });
    },
  },
];
