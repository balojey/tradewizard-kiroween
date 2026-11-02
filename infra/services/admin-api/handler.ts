/**
 * Admin API — Lambda handler.
 *
 * One Lambda serving every `/admin/*` route. The router is declarative
 * (`lib/router.ts`); each route declares its minimum role, and this handler
 * enforces it before the route body runs.
 *
 * Why one function rather than one per domain: the portal is internal and
 * low-traffic, and a single deployment unit keeps the RBAC matrix and audit
 * contract in one reviewable place. The IAM surface is scoped per permission
 * (see lib/admin-stack.ts) and the API is independently throttled.
 *
 * See docs/admin-portal-architecture.md §7.
 */

import {
  AdminAuthError,
  requireRole,
} from '../shared/admin-auth';
import { HttpError, errorResponse } from './lib/responses';
import { enforceRateLimit } from './lib/rate-limit';
import { matchRoute, ROUTES } from './lib/router';
import type { AdminApiEvent, ApiResponse } from './lib/types';

export async function handler(event: AdminApiEvent): Promise<ApiResponse> {
  try {
    const match = matchRoute(event.httpMethod, event.path);

    if (!match) {
      return errorResponse(
        event,
        404,
        'NOT_FOUND',
        `No admin route for ${event.httpMethod} ${event.path}`
      );
    }

    // Authorization happens before any parsing, validation, or I/O.
    const identity = requireRole(event, match.route.minimumRole);

    // Then the per-admin budget, which protects the database.
    await enforceRateLimit(identity, event.httpMethod !== 'GET');

    return await match.route.handler({
      event,
      identity,
      params: match.params,
    });
  } catch (error) {
    return toErrorResponse(event, error);
  }
}

function toErrorResponse(event: AdminApiEvent, error: unknown): ApiResponse {
  if (error instanceof AdminAuthError) {
    const status = error.code === 'UNAUTHORIZED' ? 401 : 403;
    return errorResponse(event, status, error.code, error.message);
  }

  if (error instanceof HttpError) {
    return errorResponse(event, error.statusCode, error.code, error.message, error.details);
  }

  // Never leak internals to the caller, but always log them for CloudWatch.
  console.error(
    JSON.stringify({
      metric: 'AdminApiError',
      path: event.path,
      method: event.httpMethod,
      requestId: event.requestContext?.requestId,
      error: (error as Error).message,
      stack: (error as Error).stack,
    })
  );

  return errorResponse(event, 500, 'INTERNAL', 'Internal server error');
}

/** Exported for the RBAC matrix test. */
export { ROUTES };
