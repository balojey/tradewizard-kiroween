/**
 * GET /admin/dashboard/summary?days=7|30|90
 *
 * Business metrics come from the hourly rollup, never from live aggregates over
 * the product tables.
 */

import { withClient } from '../lib/db';
import { HttpError, json } from '../lib/responses';
import type { AdminRoute, RouteContext } from '../lib/router';
import { getDashboard } from '../queries/dashboard';

const ALLOWED_DAYS = [7, 30, 90];

export const dashboardRoutes: AdminRoute[] = [
  {
    method: 'GET',
    path: '/admin/dashboard/summary',
    minimumRole: 'analyst',
    handler: async ({ event }: RouteContext) => {
      const raw = Number(event.queryStringParameters?.days ?? 7);
      const days = Number.isFinite(raw) ? Math.trunc(raw) : 7;

      if (!ALLOWED_DAYS.includes(days)) {
        throw new HttpError(
          400,
          'BAD_REQUEST',
          `Invalid days: use one of ${ALLOWED_DAYS.join(', ')}`
        );
      }

      return withClient(async (client) => {
        return json(event, 200, await getDashboard(client, days));
      });
    },
  },
];
