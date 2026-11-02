/**
 * GET /admin/me
 *
 * The smallest route that exercises the whole chain: token → authorizer →
 * role → handler → database. It is the slice-2 smoke test and the source of
 * truth for the admin UI's capability map.
 */

import { getUserIdByCognitoSub } from '../../shared/db';
import { json } from '../lib/responses';
import type { AdminRoute } from '../lib/router';

export const meRoute: AdminRoute = {
  method: 'GET',
  path: '/admin/me',
  minimumRole: 'analyst',
  handler: async ({ event, identity }) => {
    const userId = await getUserIdByCognitoSub(identity.sub);

    return json(event, 200, {
      sub: identity.sub,
      email: identity.email,
      role: identity.role,
      roleRank: identity.roleRank,
      mfa: identity.mfa,
      userId,
      // Distinguishes "admin group exists but no product account" from a
      // fully provisioned admin. Rotating access should surface this loudly.
      linked: userId !== null,
    });
  },
};
