/**
 * User routes: read-only views of a customer account.
 *
 * Every route requires `analyst` — support, admin and owner can read too.
 * Mutations for this domain arrive in slice 10 and will live beside these.
 */

import { withClient } from '../lib/db';
import { parsePagination, toPage } from '../lib/pagination';
import { HttpError, json } from '../lib/responses';
import type { AdminRoute, RouteContext } from '../lib/router';
import * as queries from '../queries/users';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PLANS = ['free', 'starter', 'pro', 'elite'];
const STATUSES = ['active', 'suspended', 'banned'];

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function userIdParam(params: Record<string, string>): string {
  const id = params.id;
  if (!id || !UUID_PATTERN.test(id)) {
    throw new HttpError(400, 'BAD_REQUEST', 'Invalid user id');
  }
  return id;
}

function filterValue(
  value: string | null | undefined,
  allowed: string[],
  name: string
): string | null {
  if (!value) return null;
  if (!allowed.includes(value)) {
    throw new HttpError(400, 'BAD_REQUEST', `Invalid ${name}: ${value}`);
  }
  return value;
}

/** 404 early on unknown users so sub-resource lists are never silently empty. */
async function requireUser(client: import('pg').Client, userId: string): Promise<void> {
  if (!(await queries.userExists(client, userId))) {
    throw new HttpError(404, 'NOT_FOUND', 'User not found');
  }
}

export const usersRoutes: AdminRoute[] = [
  {
    method: 'GET',
    path: '/admin/users',
    minimumRole: 'analyst',
    handler: async ({ event }: RouteContext) => {
      const { limit, cursor } = parsePagination(event.queryStringParameters);
      const params = event.queryStringParameters ?? {};

      const filters = {
        q: params.q?.trim() || null,
        plan: filterValue(params.plan, PLANS, 'plan'),
        status: filterValue(params.status, STATUSES, 'status'),
        hasPm: params.hasPm === 'true',
      };

      return withClient(async (client) => {
        const rows = await queries.listUsers(client, filters, limit, cursor);
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
    path: '/admin/users/{id}',
    minimumRole: 'analyst',
    handler: async ({ event, params }: RouteContext) => {
      const userId = userIdParam(params);

      return withClient(async (client) => {
        const user = await queries.getUserById(client, userId);
        if (!user) {
          throw new HttpError(404, 'NOT_FOUND', 'User not found');
        }
        return json(event, 200, user);
      });
    },
  },
  {
    method: 'GET',
    path: '/admin/users/{id}/credits',
    minimumRole: 'analyst',
    handler: async ({ event, params }: RouteContext) => {
      const userId = userIdParam(params);
      const { limit, cursor } = parsePagination(event.queryStringParameters);

      return withClient(async (client) => {
        await requireUser(client, userId);
        const rows = await queries.listUserCredits(client, userId, limit, cursor);
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
    path: '/admin/users/{id}/analyses',
    minimumRole: 'analyst',
    handler: async ({ event, params }: RouteContext) => {
      const userId = userIdParam(params);
      const { limit, cursor } = parsePagination(event.queryStringParameters);

      return withClient(async (client) => {
        await requireUser(client, userId);
        const rows = await queries.listUserAnalyses(client, userId, limit, cursor);
        const page = toPage(rows, limit, (row) => ({
          createdAt: iso(row.deliveredAt),
          id: String(row.deliveryId),
        }));

        return json(event, 200, page.items, { nextCursor: page.nextCursor });
      });
    },
  },
  {
    method: 'GET',
    path: '/admin/users/{id}/sessions',
    minimumRole: 'analyst',
    handler: async ({ event, params }: RouteContext) => {
      const userId = userIdParam(params);
      const { limit, cursor } = parsePagination(event.queryStringParameters);

      return withClient(async (client) => {
        await requireUser(client, userId);
        const rows = await queries.listUserSessions(client, userId, limit, cursor);
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
    path: '/admin/users/{id}/payments',
    minimumRole: 'analyst',
    handler: async ({ event, params }: RouteContext) => {
      const userId = userIdParam(params);
      const { limit, cursor } = parsePagination(event.queryStringParameters);

      return withClient(async (client) => {
        await requireUser(client, userId);
        const rows = await queries.listUserPayments(client, userId, limit, cursor);
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
    path: '/admin/users/{id}/notes',
    minimumRole: 'analyst',
    handler: async ({ event, params }: RouteContext) => {
      const userId = userIdParam(params);
      const { limit, cursor } = parsePagination(event.queryStringParameters);

      return withClient(async (client) => {
        await requireUser(client, userId);
        const rows = await queries.listUserNotes(client, userId, limit, cursor);
        const page = toPage(rows, limit, (row) => ({
          createdAt: iso(row.createdAt),
          id: String(row.id),
        }));

        return json(event, 200, page.items, { nextCursor: page.nextCursor });
      });
    },
  },
];
