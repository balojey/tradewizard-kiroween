/**
 * Market schedule routes: the shared analysis pool.
 *
 * Read-only. Pause/resume/force-run are mutations and land in slice 10.
 */

import { withClient } from '../lib/db';
import { parsePagination, toPage } from '../lib/pagination';
import { HttpError, json } from '../lib/responses';
import type { AdminRoute, RouteContext } from '../lib/router';
import * as queries from '../queries/markets';

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export const marketsRoutes: AdminRoute[] = [
  {
    method: 'GET',
    path: '/admin/markets/summary',
    minimumRole: 'analyst',
    handler: async ({ event }: RouteContext) => {
      return withClient(async (client) => {
        return json(event, 200, await queries.getScheduleSummary(client));
      });
    },
  },
  {
    method: 'GET',
    path: '/admin/markets/schedule',
    minimumRole: 'analyst',
    handler: async ({ event }: RouteContext) => {
      const params = event.queryStringParameters ?? {};
      const { limit, cursor } = parsePagination(params);

      const status = params.status?.trim() || null;
      if (status && status.length > 32) {
        throw new HttpError(400, 'BAD_REQUEST', 'Invalid status');
      }

      const filters = { status, stuckOnly: params.stuck === 'true' };

      return withClient(async (client) => {
        const rows = await queries.listSchedules(client, filters, limit, cursor);
        const page = toPage(rows, limit, (row) => ({
          createdAt: iso(row.nextScheduledRun),
          id: String(row.id),
        }));

        return json(event, 200, page.items, { nextCursor: page.nextCursor });
      });
    },
  },
];
