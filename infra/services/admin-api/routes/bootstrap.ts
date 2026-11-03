/**
 * MFA enrolment for an admin who signed in without a factor.
 *
 * This is the only route reachable while the MFA policy is unsatisfied, so it
 * does two things carefully:
 *
 * 1. It refuses unless the factor is **actually configured** — the authorizer's
 *    read of Cognito, not the client's claim. A client cannot fake enrolment to
 *    get an audit row.
 * 2. It records the enrolment, so "this account gained its second factor" is in
 *    the governance log rather than only in Cognito.
 */

import { writeAuditLog, completeAudit } from '../lib/audit';
import { withClient } from '../lib/db';
import { HttpError, json } from '../lib/responses';
import type { AdminRoute, RouteContext } from '../lib/router';

export const bootstrapRoutes: AdminRoute[] = [
  {
    // API Gateway replaces the authorizer's error with a generic 403 body, so the
    // client cannot read "MFA_REQUIRED" from the rejection. This endpoint is the
    // one place an MFA-less admin can reach, and it answers *why* they were denied.
    method: 'GET',
    path: '/admin/bootstrap/status',
    minimumRole: 'analyst',
    handler: async ({ event, identity }: RouteContext) => {
      return json(event, 200, {
        sub: identity.sub,
        email: identity.email,
        role: identity.role,
        mfa: identity.mfa,
      });
    },
  },
  {
    method: 'POST',
    path: '/admin/bootstrap/mfa-enrolled',
    // Any admin role: this is about the caller's own account.
    minimumRole: 'analyst',
    handler: async ({ event, identity }: RouteContext) => {
      if (!identity.mfa) {
        throw new HttpError(
          409,
          'CONFLICT',
          'No TOTP factor is configured for this account yet. Complete enrolment first.'
        );
      }

      return withClient(async (client) => {
        const auditId = await writeAuditLog(client, {
          actor: identity,
          action: 'admin.mfa.enrolled',
          targetType: 'admin',
          targetId: identity.sub,
          reason: 'Second factor enrolled from the portal',
          before: { mfa: false },
          requestId: event.requestContext?.requestId ?? null,
          ip: event.requestContext?.identity?.sourceIp ?? null,
        });

        await completeAudit(client, auditId, {
          status: 'succeeded',
          after: { mfa: true, role: identity.role },
        });

        return json(event, 200, { sub: identity.sub, mfa: true });
      });
    },
  },
];
