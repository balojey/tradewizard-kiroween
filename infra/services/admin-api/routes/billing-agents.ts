/**
 * Billing and agent routes.
 *
 * Read-only: reconciliation, trial extension and refunds are mutations and land
 * in slice 10 with an audit row and a mandatory reason.
 */

import { withClient } from '../lib/db';
import { parsePagination, toPage } from '../lib/pagination';
import { HttpError, json } from '../lib/responses';
import { parseOptionalDate, parseWindow } from '../lib/window';
import type { AdminRoute, RouteContext } from '../lib/router';
import * as billing from '../queries/billing';
import * as agents from '../queries/agents';

const PLANS = ['free', 'starter', 'pro', 'elite'];
const PAYMENT_TYPES = [
  'subscription_payment',
  'credit_pack_purchase',
  'renewal_payment',
  'proration_credit',
];
const RENEWAL_STATES = ['ok', 'failing', 'grace', 'paused'];

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function allowlisted(
  raw: string | null | undefined,
  allowed: string[],
  name: string
): string | null {
  if (!raw) return null;
  if (!allowed.includes(raw)) {
    throw new HttpError(400, 'BAD_REQUEST', `Invalid ${name}: ${raw}`);
  }
  return raw;
}

export const billingRoutes: AdminRoute[] = [
  {
    method: 'GET',
    path: '/admin/billing/summary',
    minimumRole: 'analyst',
    handler: async ({ event }: RouteContext) => {
      const window = parseWindow(event.queryStringParameters);

      return withClient(async (client) => {
        return json(event, 200, await billing.getBillingSummary(client, window));
      });
    },
  },
  {
    method: 'GET',
    path: '/admin/payments',
    minimumRole: 'analyst',
    handler: async ({ event }: RouteContext) => {
      const params = event.queryStringParameters ?? {};
      const { limit, cursor } = parsePagination(params);

      const filters = {
        from: parseOptionalDate(params.from, 'from'),
        to: parseOptionalDate(params.to, 'to'),
        type: allowlisted(params.type, PAYMENT_TYPES, 'type'),
      };

      return withClient(async (client) => {
        const rows = await billing.listPayments(client, filters, limit, cursor);
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
    path: '/admin/subscriptions',
    minimumRole: 'analyst',
    handler: async ({ event }: RouteContext) => {
      const params = event.queryStringParameters ?? {};
      const { limit, cursor } = parsePagination(params);

      const filters = {
        plan: allowlisted(params.plan, PLANS, 'plan'),
        renewal: allowlisted(params.renewal, RENEWAL_STATES, 'renewal'),
      };

      return withClient(async (client) => {
        const rows = await billing.listSubscriptions(client, filters, limit, cursor);
        const page = toPage(rows, limit, (row) => ({
          createdAt: iso(row.createdAt),
          id: String(row.id),
        }));

        return json(event, 200, page.items, { nextCursor: page.nextCursor });
      });
    },
  },
];

export const agentsRoutes: AdminRoute[] = [
  {
    method: 'GET',
    path: '/admin/agents/performance',
    minimumRole: 'analyst',
    handler: async ({ event }: RouteContext) => {
      return withClient(async (client) => {
        const rows = await agents.listAgentPerformance(client);
        return json(event, 200, rows);
      });
    },
  },
  {
    method: 'GET',
    path: '/admin/agents/cost',
    minimumRole: 'analyst',
    handler: async ({ event }: RouteContext) => {
      const window = parseWindow(event.queryStringParameters);

      return withClient(async (client) => {
        return json(event, 200, await agents.getAgentCostReport(client, window));
      });
    },
  },
];
