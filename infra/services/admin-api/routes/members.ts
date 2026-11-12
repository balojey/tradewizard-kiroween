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
import { AdminEmailError, toAdminEmail } from '../../shared/admin-email';
import { sendAdminInvitation } from '../../shared/admin-invite-email';
import { generateTemporaryPassword } from '../../shared/temp-password';
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
import { isProductUserByCognitoSub } from '../queries/users';

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

/** Alias the typed address, turning the helper's error into a 400. */
function adminAlias(raw: string): { adminEmail: string; changed: boolean } {
  try {
    const result = toAdminEmail(raw);
    return { adminEmail: result.adminEmail, changed: result.changed };
  } catch (error) {
    if (error instanceof AdminEmailError) {
      throw new HttpError(400, 'BAD_REQUEST', error.message);
    }
    throw error;
  }
}

function isAdmin(groups: string[]): boolean {
  return groups.some((group) => group in ROLE_GROUPS);
}

/**
 * Refuse an identity that belongs to a product account.
 *
 * Group membership alone cannot distinguish "a customer" from "an admin account
 * that has not been grouped yet", so ask the product database: it provisions a
 * `users` row for every customer and none for a dedicated admin identity.
 */
async function assertNotProductAccount(sub: string, adminEmail: string): Promise<void> {
  const linked = await withClient((client) => isProductUserByCognitoSub(client, sub));

  if (linked) {
    throw new HttpError(
      409,
      'CONFLICT',
      'That address belongs to a TradeWizard product account. Adding it here would break its magic-link sign-in. Invite the dedicated Warden address instead.',
      { adminEmail }
    );
  }
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

      const alias = adminAlias(input.email);
      const typedEmail = input.email.trim().toLowerCase();

      // Resolve the identity this request targets.
      //
      // A customer account must never receive an admin group: setting a portal
      // password or enrolling TOTP on it breaks the product's magic-link sign-in
      // (architecture §6.1, incident 2026-11-03). The alias exists precisely so
      // the operator does not have to remember that rule.
      let user = await findUserByEmail(typedEmail);

      if (user) {
        const groups = await getGroupsForUser(user.sub);
        if (!isAdmin(groups)) {
          await assertNotProductAccount(user.sub, alias.adminEmail);
        }
      }

      // The aliased address may already exist even when the typed one does not:
      // a previous invitation, or someone typed the +warden form themselves.
      if (!user && alias.adminEmail !== typedEmail) {
        const aliased = await findUserByEmail(alias.adminEmail);

        if (aliased) {
          const groups = await getGroupsForUser(aliased.sub);
          if (!isAdmin(groups)) {
            await assertNotProductAccount(aliased.sub, alias.adminEmail);
          }
          user = aliased;
        }
      }

      let invited = false;
      let temporaryPassword: string | null = null;

      if (!user) {
        if (input.invite !== true) {
          throw new HttpError(
            404,
            'NOT_FOUND',
            'No account uses that email. Send the invitation again with invite:true to create it.',
            { adminEmail: alias.adminEmail }
          );
        }

        temporaryPassword = generateTemporaryPassword();
        const created = await createInvitedUser({
          email: alias.adminEmail,
          temporaryPassword,
        });
        user = { sub: created.sub, email: alias.adminEmail, status: created.status };
        invited = true;
      }

      const existingGroups = await getGroupsForUser(user.sub);
      if (isAdmin(existingGroups)) {
        throw new HttpError(409, 'CONFLICT', 'That account is already a member');
      }

      await addToGroup(user.sub, groupForRole(input.role));

      // Same delivery path as the public join flow: our Resend email, not
      // Cognito's default sender. A delivery failure must not undo the account
      // or the group — the owner can resend from the runbook.
      let emailSent: boolean | null = null;
      if (invited && temporaryPassword) {
        try {
          await sendAdminInvitation({
            to: user.email,
            role: input.role,
            temporaryPassword,
            idempotencyKey: `warden-invite-${user.sub}`,
          });
          emailSent = true;
        } catch (error) {
          emailSent = false;
          console.error('Invitation email failed for a manually invited member', {
            sub: user.sub,
            error: (error as Error).message,
          });
        }
      }

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
          after: { role: input.role, email: user.email, invited, emailSent },
        });

        return json(event, 201, {
          sub: user.sub,
          email: user.email,
          adminEmail: alias.adminEmail,
          aliased: user.email !== typedEmail,
          role: input.role,
          invited,
          emailSent,
          note: invited
            ? emailSent
              ? 'Invitation emailed. They choose their own password at first sign-in, then enrol an authenticator.'
              : 'Account created, but the invitation email failed. Resend it from the runbook before telling them to sign in.'
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
      // The authorizer already reads live groups, so the demotion is effective on
      // the next request; revoking refresh tokens additionally stops the client
      // from refreshing a session that no longer has the old role.
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

      // Stop the client refreshing; the authorizer's live group check is what
      // ends access on the next request.
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
