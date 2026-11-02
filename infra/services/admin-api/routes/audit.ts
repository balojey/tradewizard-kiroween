/**
 * Audit routes.
 *
 * The viewer is read-only by construction: there is no update or delete path,
 * and the database trigger rejects both.
 */

import { withClient } from '../lib/db';
import { parsePagination, toPage } from '../lib/pagination';
import { HttpError, json } from '../lib/responses';
import { parseOptionalDate } from '../lib/window';
import type { AdminRoute, RouteContext } from '../lib/router';
import { listAuditEntries } from '../queries/audit';

const STATUSES = ['pending', 'succeeded', 'failed'];

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export const auditRoutes: AdminRoute[] = [
  {
    method: 'GET',
    path: '/admin/audit',
    minimumRole: 'analyst',
    handler: async ({ event }: RouteContext) => {
      const params = event.queryStringParameters ?? {};
      const { limit, cursor } = parsePagination(params);

      if (params.status && !STATUSES.includes(params.status)) {
        throw new HttpError(400, 'BAD_REQUEST', `Invalid status: ${params.status}`);
      }

      const filters = {
        actor: params.actor?.trim() || null,
        action: params.action?.trim() || null,
        targetType: params.targetType?.trim() || null,
        targetId: params.targetId?.trim() || null,
        status: params.status ?? null,
        from: parseOptionalDate(params.from, 'from'),
        to: parseOptionalDate(params.to, 'to'),
      };

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
];
