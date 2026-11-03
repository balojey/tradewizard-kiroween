/**
 * Admin membership routes (owner only).
 *
 * Membership is Cognito group state, so these endpoints call Cognito rather than
 * the database. Every change is audited; the audit row is what explains a role
 * change six months later.
 *
 * Safety rules:
 * - at least one owner must always remain
 * - adding an existing member is a conflict, not a silent no-op
 * - creating an account requires an explicit `invite: true`. A mistyped address
 *   must not silently create a stranger's account, so the caller confirms first
 * - the portal never sets a password: Cognito emails an invitation and the person
 *   chooses their own at first sign-in
 */

import { z } from 'zod';
import { writeAuditLog, completeAudit } from '../lib/audit';
import { withClient } from '../lib/db';
import { HttpError, json } from '../lib/responses';
import { parseBody } from '../lib/validation';
import type { AdminRoute, RouteContext } from '../lib/router';
import {
  groupForRole,
  requireFreshAuth,
  ROLE_GROUPS,
  ROLE_RANK,
  type AdminRole,
} from '../../shared/admin-auth';
import {
  addToGroup,
  countOwners,
  createInvitedUser,
  findUserByEmail,
  globalSignOut,
  getGroupsForUser,
  listMembers,
  removeFromGroup,
} from '../queries/members';

const ROLES = ['analyst', 'support', 'admin', 'owner'] as const;

const addSchema = z.object({
  email: z.string().trim().email('Enter a valid email address').max(254),
  role: z.enum(ROLES),
  reason: z.string().trim().min(8, 'Reason must be at least 8 characters').max(500),
  /** Create the account (and let Cognito email the invitation) when missing. */
  invite: z.boolean().optional(),
});

const roleSchema = z.object({
  role: z.enum(ROLES),
  reason: z.string().trim().min(8, 'Reason must be at least 8 characters').max(500),
});

const removeSchema = z.object({
  reason: z.string().trim().min(8, 'Reason must be at least 8 characters').max(500),
});

function subParam(params: Record<string, string>): string {
  const sub = params.sub;
  if (!sub || sub.length < 8 || sub.length > 128) {
    throw new HttpError(400, 'BAD_REQUEST', 'Invalid member id');
  }
  return sub;
}

/** Replace whatever admin groups the user has with exactly the target role. */
async function setRole(sub: string, role: AdminRole): Promise<{ from: string[] }> {
  const current = await getGroupsForUser(sub);
  const adminGroups = current.filter((group) => group in ROLE_GROUPS);

  for (const group of adminGroups) {
    await removeFromGroup(sub, group);
  }

  await addToGroup(sub, groupForRole(role));
  return { from: adminGroups };
}

export const memberRoutes: AdminRoute[] = [
  {
    method: 'GET',
    path: '/admin/admins',
    minimumRole: 'owner',
    handler: async ({ event }: RouteContext) => {
      const members = await listMembers();
      return json(event, 200, members);
    },
  },
  {
    method: 'POST',
    path: '/admin/admins',
    minimumRole: 'owner',
    handler: async ({ event, identity }: RouteContext) => {
      requireFreshAuth(identity);
      const input = parseBody(addSchema, event.body);

      const existing = await findUserByEmail(input.email);

      let user = existing;
      let invited = false;

      if (!user) {
        if (input.invite !== true) {
          throw new HttpError(
            404,
            'NOT_FOUND',
            'No account uses that email. Send the invitation again with invite:true to create it.'
          );
        }

        const created = await createInvitedUser(input.email);
        user = { sub: created.sub, email: input.email, status: created.status };
        invited = true;
      }

      const existingGroups = await getGroupsForUser(user.sub);
      if (existingGroups.some((group) => group in ROLE_GROUPS)) {
        throw new HttpError(409, 'CONFLICT', 'That account is already a member');
      }

      await addToGroup(user.sub, groupForRole(input.role));

      return withClient(async (client) => {
        const auditId = await writeAuditLog(client, {
          actor: identity,
          action: 'admin.role.add',
          targetType: 'admin',
          targetId: user.sub,
          reason: input.reason,
          before: { role: null },
          requestId: event.requestContext?.requestId ?? null,
          ip: event.requestContext?.identity?.sourceIp ?? null,
        });

        await completeAudit(client, auditId, {
          status: 'succeeded',
          after: { role: input.role, email: user.email, invited },
        });

        return json(event, 201, {
          sub: user.sub,
          email: user.email,
          role: input.role,
          invited,
          note: invited
            ? 'Invitation sent. They choose their own password at first sign-in, then enrol an authenticator.'
            : 'Existing account added to the group.',
        });
      });
    },
  },
  {
    method: 'PUT',
    path: '/admin/admins/{sub}',
    minimumRole: 'owner',
    handler: async ({ event, identity, params }: RouteContext) => {
      requireFreshAuth(identity);
      const sub = subParam(params);
      const input = parseBody(roleSchema, event.body);

      const currentGroups = await getGroupsForUser(sub);
      const currentRole = (Object.keys(ROLE_GROUPS) as string[])
        .filter((group) => currentGroups.includes(group))
        .map((group) => ROLE_GROUPS[group])
        .sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])[0] as AdminRole | undefined;

      if (!currentRole) {
        throw new HttpError(404, 'NOT_FOUND', 'That account is not a member');
      }

      // Demoting the last owner would leave the portal unadministrable.
      if (currentRole === 'owner' && input.role !== 'owner' && (await countOwners()) <= 1) {
        throw new HttpError(409, 'CONFLICT', 'The last owner cannot be demoted');
      }

      await setRole(sub, input.role);
      // Tokens carry the old groups; force re-authentication so a demotion is
      // effective now rather than in up to an hour.
      await globalSignOut(sub);

      return withClient(async (client) => {
        const auditId = await writeAuditLog(client, {
          actor: identity,
          action: 'admin.role.change',
          targetType: 'admin',
          targetId: sub,
          reason: input.reason,
          before: { role: currentRole },
          requestId: event.requestContext?.requestId ?? null,
          ip: event.requestContext?.identity?.sourceIp ?? null,
        });

        await completeAudit(client, auditId, { status: 'succeeded', after: { role: input.role } });

        return json(event, 200, { sub, role: input.role, previousRole: currentRole });
      });
    },
  },
  {
    method: 'DELETE',
    path: '/admin/admins/{sub}',
    minimumRole: 'owner',
    handler: async ({ event, identity, params }: RouteContext) => {
      requireFreshAuth(identity);
      const sub = subParam(params);
      const input = parseBody(removeSchema, event.body);

      const currentGroups = (await getGroupsForUser(sub)).filter((group) => group in ROLE_GROUPS);
      if (currentGroups.length === 0) {
        throw new HttpError(404, 'NOT_FOUND', 'That account is not a member');
      }

      if (currentGroups.includes('tw-owner') && (await countOwners()) <= 1) {
        throw new HttpError(409, 'CONFLICT', 'The last owner cannot be removed');
      }

      for (const group of currentGroups) {
        await removeFromGroup(sub, group);
      }

      // Revoke immediately: an issued token would otherwise keep portal access
      // until it expired.
      await globalSignOut(sub);

      return withClient(async (client) => {
        const auditId = await writeAuditLog(client, {
          actor: identity,
          action: 'admin.role.remove',
          targetType: 'admin',
          targetId: sub,
          reason: input.reason,
          before: { groups: currentGroups },
          requestId: event.requestContext?.requestId ?? null,
          ip: event.requestContext?.identity?.sourceIp ?? null,
        });

        await completeAudit(client, auditId, { status: 'succeeded', after: { groups: [] } });

        return json(event, 200, { sub, removed: true });
      });
    },
  },
];
