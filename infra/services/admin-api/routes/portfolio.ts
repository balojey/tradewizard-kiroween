/**
 * Portfolio manager routes: cross-user sessions, their trades and decisions, and
 * an open-exposure summary.
 *
 * Read-only. Controls (pause, resume, terminate, kill switch) land in slice 10 —
 * this slice exists so an operator can see what those controls would affect.
 */

import { withClient } from '../lib/db';
import { parsePagination, toPage } from '../lib/pagination';
import { HttpError, json } from '../lib/responses';
import type { AdminRoute, RouteContext } from '../lib/router';
import * as queries from '../queries/portfolio';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SESSION_STATUSES = ['active', 'paused', 'exiting', 'completed', 'terminated'];

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function sessionIdParam(params: Record<string, string>): string {
  const id = params.id;
  if (!id || !UUID_PATTERN.test(id)) {
    throw new HttpError(400, 'BAD_REQUEST', 'Invalid session id');
  }
  return id;
}

async function requireSession(client: import('pg').Client, sessionId: string): Promise<void> {
  if (!(await queries.sessionExists(client, sessionId))) {
    throw new HttpError(404, 'NOT_FOUND', 'Session not found');
  }
}

export const portfolioRoutes: AdminRoute[] = [
  {
    method: 'GET',
    path: '/admin/portfolio/sessions',
    minimumRole: 'analyst',
    handler: async ({ event }: RouteContext) => {
      const params = event.queryStringParameters ?? {};
      const { limit, cursor } = parsePagination(params);

      if (params.status && !SESSION_STATUSES.includes(params.status)) {
        throw new HttpError(400, 'BAD_REQUEST', `Invalid status: ${params.status}`);
      }
      if (params.userId && !UUID_PATTERN.test(params.userId)) {
        throw new HttpError(400, 'BAD_REQUEST', 'Invalid userId');
      }

      const filters = {
        status: params.status ?? null,
        userId: params.userId ?? null,
        marketId: params.marketId?.trim() || null,
      };

      return withClient(async (client) => {
        const rows = await queries.listSessions(client, filters, limit, cursor);
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
    path: '/admin/portfolio/exposure',
    minimumRole: 'analyst',
    handler: async ({ event }: RouteContext) => {
      return withClient(async (client) => {
        const report = await queries.getExposure(client);
        return json(event, 200, report);
      });
    },
  },
  {
    method: 'GET',
    path: '/admin/portfolio/sessions/{id}',
    minimumRole: 'analyst',
    handler: async ({ event, params }: RouteContext) => {
      const sessionId = sessionIdParam(params);

      return withClient(async (client) => {
        const session = await queries.getSessionById(client, sessionId);
        if (!session) {
          throw new HttpError(404, 'NOT_FOUND', 'Session not found');
        }
        return json(event, 200, session);
      });
    },
  },
  {
    method: 'GET',
    path: '/admin/portfolio/sessions/{id}/trades',
    minimumRole: 'analyst',
    handler: async ({ event, params }: RouteContext) => {
      const sessionId = sessionIdParam(params);
      const { limit, cursor } = parsePagination(event.queryStringParameters);

      return withClient(async (client) => {
        await requireSession(client, sessionId);
        const rows = await queries.listSessionTrades(client, sessionId, limit, cursor);
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
    path: '/admin/portfolio/sessions/{id}/decisions',
    minimumRole: 'analyst',
    handler: async ({ event, params }: RouteContext) => {
      const sessionId = sessionIdParam(params);
      const { limit, cursor } = parsePagination(event.queryStringParameters);

      return withClient(async (client) => {
        await requireSession(client, sessionId);
        const rows = await queries.listSessionDecisions(client, sessionId, limit, cursor);
        const page = toPage(rows, limit, (row) => ({
          createdAt: iso(row.createdAt),
          id: String(row.id),
        }));

        return json(event, 200, page.items, { nextCursor: page.nextCursor });
      });
    },
  },
];
