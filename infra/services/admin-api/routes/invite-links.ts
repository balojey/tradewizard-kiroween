/**
 * Owner-managed invite links.
 *
 * A link is a bearer credential that grants one role to whoever registers
 * through it. The URL is returned exactly once, because only the SHA-256 of the
 * token is stored; losing it means creating another link, which is the intended
 * property (docs/warden-invite-links-plan.md §2.6).
 *
 * Safety rules, all enforced here rather than in the UI:
 * - owner role + fresh authentication for every action;
 * - the reason is mandatory and lands in the audit row;
 * - revoking is immediate and cannot be undone (create a new link instead);
 * - revoking can also disable accounts created by the link that never signed in.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { writeAuditLog, completeAudit } from '../lib/audit';
import { withClient } from '../lib/db';
import { HttpError, json } from '../lib/responses';
import { parseBody } from '../lib/validation';
import type { AdminRoute, RouteContext } from '../lib/router';
import { requireFreshAuth } from '../../shared/admin-auth';
import { generateInviteToken, hashInviteToken, inviteLinkStatus } from '../../shared/invite-token';
import {
  createInviteLink,
  findInviteLinkById,
  listInviteLinks,
  listInviteRedemptions,
  revokeInviteLink,
} from '../../shared/invite-links';
import { disableUser, getUserStatus } from '../queries/members';

const ROLES = ['analyst', 'support', 'admin', 'owner'] as const;

/** 365 days. Longer-lived bearer links defeat the point of expiry. */
export const MAX_INVITE_LIFETIME_HOURS = 8760;

const createSchema = z.object({
  role: z.enum(ROLES),
  expiresInHours: z.number().int().min(1).max(MAX_INVITE_LIFETIME_HOURS).default(168),
  maxUses: z.number().int().min(1).max(50).default(5),
  reason: z.string().trim().min(8, 'Reason must be at least 8 characters').max(500),
});

const revokeSchema = z.object({
  reason: z.string().trim().min(8, 'Reason must be at least 8 characters').max(500),
  /** Also disable accounts created by this link that have never signed in. */
  disableUnclaimed: z.boolean().optional(),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idParam(params: Record<string, string>): string {
  const id = params.id ?? '';

  if (!UUID.test(id)) {
    throw new HttpError(400, 'BAD_REQUEST', 'Invalid invite link id');
  }

  return id;
}

function adminAppUrl(): string {
  return (process.env.ADMIN_APP_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
}

/** Statuses that mean the temporary password has never been replaced. */
function isUnclaimed(status: string): boolean {
  return status === 'FORCE_CHANGE_PASSWORD' || status === 'UNCONFIRMED';
}

export const inviteLinkRoutes: AdminRoute[] = [
  {
    method: 'GET',
    path: '/admin/invite-links',
    minimumRole: 'owner',
    handler: async ({ event }: RouteContext) => {
      const links = await withClient(async (client) => listInviteLinks(client));

      return json(
        event,
        200,
        links.map((link) => ({
          id: link.id,
          role: link.role,
          createdByEmail: link.createdByEmail,
          reason: link.reason,
          createdAt: link.createdAt,
          expiresAt: link.expiresAt,
          maxUses: link.maxUses,
          useCount: link.useCount,
          redemptionCount: link.redemptionCount ?? 0,
          revokedAt: link.revokedAt,
          revokedBy: link.revokedBy,
          lastUsedAt: link.lastUsedAt,
          status: inviteLinkStatus(link),
        }))
      );
    },
  },
  {
    method: 'POST',
    path: '/admin/invite-links',
    minimumRole: 'owner',
    handler: async ({ event, identity }: RouteContext) => {
      requireFreshAuth(identity);
      const input = parseBody(createSchema, event.body);

      const token = generateInviteToken();
      const tokenHash = hashInviteToken(token);
      const linkId = randomUUID();
      const expiresAt = new Date(Date.now() + input.expiresInHours * 3_600_000);
      const url = `${adminAppUrl()}/join#t=${token}`;

      return withClient(async (client) => {
        const auditId = await writeAuditLog(client, {
          actor: identity,
          action: 'admin.invite_link.create',
          targetType: 'invite_link',
          targetId: linkId,
          reason: input.reason,
          before: null,
          requestId: event.requestContext?.requestId ?? null,
          ip: event.requestContext?.identity?.sourceIp ?? null,
        });

        try {
          const link = await createInviteLink(client, {
            id: linkId,
            tokenHash,
            role: input.role,
            createdBySub: identity.sub,
            createdByEmail: identity.email,
            reason: input.reason,
            expiresAt,
            maxUses: input.maxUses,
          });

          await completeAudit(client, auditId, {
            status: 'succeeded',
            after: {
              linkId: link.id,
              role: link.role,
              expiresAt: link.expiresAt,
              maxUses: link.maxUses,
            },
          });

          // The only time the URL is ever returned. Never logged, never audited.
          return json(event, 201, {
            id: link.id,
            role: link.role,
            url,
            expiresAt: link.expiresAt,
            maxUses: link.maxUses,
          });
        } catch (error) {
          await completeAudit(client, auditId, {
            status: 'failed',
            error: (error as Error).message,
          });
          throw error;
        }
      });
    },
  },
  {
    method: 'GET',
    path: '/admin/invite-links/{id}/redemptions',
    minimumRole: 'owner',
    handler: async ({ event, params }: RouteContext) => {
      const id = idParam(params);

      const redemptions = await withClient(async (client) => {
        const link = await findInviteLinkById(client, id);
        if (!link) {
          throw new HttpError(404, 'NOT_FOUND', 'No such invite link');
        }
        return listInviteRedemptions(client, id);
      });

      // Best effort: Cognito is the source of truth for whether a temp password
      // has been replaced, and this is a drill-down, not a hot path.
      const rows = await Promise.all(
        redemptions.map(async (redemption) => {
          let cognitoStatus: string | null = null;
          try {
            cognitoStatus = await getUserStatus(redemption.cognitoSub);
          } catch {
            cognitoStatus = null;
          }

          return {
            id: redemption.id,
            cognitoSub: redemption.cognitoSub,
            email: redemption.email,
            createdAt: redemption.createdAt,
            cognitoStatus,
            claimed: cognitoStatus ? !isUnclaimed(cognitoStatus) : null,
          };
        })
      );

      return json(event, 200, rows);
    },
  },
  {
    method: 'DELETE',
    path: '/admin/invite-links/{id}',
    minimumRole: 'owner',
    handler: async ({ event, identity, params }: RouteContext) => {
      requireFreshAuth(identity);
      const id = idParam(params);
      const input = parseBody(revokeSchema, event.body);

      return withClient(async (client) => {
        const existing = await findInviteLinkById(client, id);

        if (!existing) {
          throw new HttpError(404, 'NOT_FOUND', 'No such invite link');
        }

        if (existing.revokedAt) {
          throw new HttpError(409, 'CONFLICT', 'That link was already revoked');
        }

        const auditId = await writeAuditLog(client, {
          actor: identity,
          action: 'admin.invite_link.revoke',
          targetType: 'invite_link',
          targetId: id,
          reason: input.reason,
          before: { revokedAt: null, useCount: existing.useCount },
          requestId: event.requestContext?.requestId ?? null,
          ip: event.requestContext?.identity?.sourceIp ?? null,
        });

        try {
          const revoked = await revokeInviteLink(client, id, identity.email);

          if (!revoked) {
            // Lost a race with another owner; the link is revoked either way.
            throw new HttpError(409, 'CONFLICT', 'That link was already revoked');
          }

          let disabled = 0;

          if (input.disableUnclaimed) {
            const redemptions = await listInviteRedemptions(client, id);

            for (const redemption of redemptions) {
              try {
                const status = await getUserStatus(redemption.cognitoSub);
                if (isUnclaimed(status)) {
                  await disableUser(redemption.cognitoSub);
                  disabled += 1;
                }
              } catch (error) {
                // A single failure must not undo the revocation. Log, count
                // nothing, and let the audit row say how many were disabled.
                console.error('Could not disable unclaimed invitee', {
                  sub: redemption.cognitoSub,
                  error: (error as Error).message,
                });
              }
            }
          }

          await completeAudit(client, auditId, {
            status: 'succeeded',
            after: { revokedAt: revoked.revokedAt, disabled },
          });

          return json(event, 200, { id, revoked: true, disabled });
        } catch (error) {
          await completeAudit(client, auditId, {
            status: 'failed',
            error: (error as Error).message,
          });
          throw error;
        }
      });
    },
  },
];
