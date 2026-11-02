/**
 * GET /admin/ops/health
 *
 * Queues, Lambda error rates, alarm state, and database size. Read-only.
 */

import { withClient } from '../lib/db';
import { json } from '../lib/responses';
import type { AdminRoute, RouteContext } from '../lib/router';
import { getOpsHealth } from '../queries/ops';

export const opsRoutes: AdminRoute[] = [
  {
    method: 'GET',
    path: '/admin/ops/health',
    minimumRole: 'analyst',
    handler: async ({ event }: RouteContext) => {
      return withClient(async (client) => {
        return json(event, 200, await getOpsHealth(client));
      });
    },
  },
];
