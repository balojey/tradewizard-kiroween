/**
 * User mutations.
 *
 * This file starts deliberately small: support notes. It establishes the
 * pattern every later mutation copies —
 *
 *   1. `requireRole` (already done by the handler)
 *   2. validate the body with zod
 *   3. confirm the target exists
 *   4. `withAudit` — audit row first, then the work
 *   5. return the created resource
 *
 * Money-moving mutations (credits, refunds) add idempotency and row locks on top
 * of this same shape.
 */

import { completeAudit, writeAuditLog, withAudit } from '../lib/audit';
import { withClient } from '../lib/db';
import { HttpError, json } from '../lib/responses';
import {
  creditGrantSchema,
  idempotencyKey,
  noteSchema,
  parseBody,
  planOverrideSchema,
  revokeSchema,
  statusChangeSchema,
} from '../lib/validation';
import type { AdminRoute, RouteContext } from '../lib/router';
import { findAuditByKey } from '../queries/audit';
import { addCredits, lockSubscription } from '../queries/credits';
import { getActiveOverride, grantOverride, revokeOverride } from '../../shared/plan-overrides';
import { userExists } from '../queries/users';

const CREDIT_GRANT_ACTION = 'user.credits.grant';
const STATUS_CHANGE_ACTION = 'user.status.update';
const PLAN_OVERRIDE_ACTION = 'user.plan.override';
const PLAN_REVOKE_ACTION = 'user.plan.override.revoke';

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === '23505';
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function userIdParam(params: Record<string, string>): string {
  const id = params.id;
  if (!id || !UUID_PATTERN.test(id)) {
    throw new HttpError(400, 'BAD_REQUEST', 'Invalid user id');
  }
  return id;
}

export const userMutationRoutes: AdminRoute[] = [
  {
    method: 'POST',
    path: '/admin/users/{id}/notes',
    minimumRole: 'support',
    handler: async ({ event, identity, params }: RouteContext) => {
      const userId = userIdParam(params);
      const input = parseBody(noteSchema, event.body);

      return withClient(async (client) => {
        if (!(await userExists(client, userId))) {
          throw new HttpError(404, 'NOT_FOUND', 'User not found');
        }

        const note = await withAudit(
          client,
          {
            actor: identity,
            action: 'user.note.create',
            targetType: 'user',
            targetId: userId,
            reason: input.reason,
            ip: event.requestContext?.identity?.sourceIp ?? null,
            userAgent: event.headers?.['user-agent'] ?? event.headers?.['User-Agent'] ?? null,
            requestId: event.requestContext?.requestId ?? null,
          },
          async () => {
            const result = await client.query(
              `
              INSERT INTO admin_user_notes (user_id, author_sub, author_email, body)
              VALUES ($1, $2, $3, $4)
              RETURNING id, body, created_at AS "createdAt"
              `,
              [userId, identity.sub, identity.email, input.body]
            );

            const created = result.rows[0];
            return {
              result: created,
              after: { noteId: created.id, bodyLength: input.body.length },
            };
          }
        );

        return json(event, 201, note);
      });
    },
  },
  {
    method: 'POST',
    path: '/admin/users/{id}/credits',
    minimumRole: 'support',
    handler: async ({ event, identity, params }: RouteContext) => {
      const userId = userIdParam(params);
      const input = parseBody(creditGrantSchema, event.body);
      const key = idempotencyKey(event.headers);

      return withClient(async (client) => {
        if (!(await userExists(client, userId))) {
          throw new HttpError(404, 'NOT_FOUND', 'User not found');
        }

        // The audit row doubles as the idempotency ledger: a unique index on
        // (actor, action, key) makes a retried request detectable.
        let auditId: string;

        try {
          auditId = await writeAuditLog(client, {
            actor: identity,
            action: CREDIT_GRANT_ACTION,
            targetType: 'user',
            targetId: userId,
            reason: input.reason,
            ip: event.requestContext?.identity?.sourceIp ?? null,
            userAgent: event.headers?.['user-agent'] ?? event.headers?.['User-Agent'] ?? null,
            requestId: event.requestContext?.requestId ?? null,
            idempotencyKey: key,
          });
        } catch (error) {
          if (isUniqueViolation(error) && key) {
            const prior = await findAuditByKey(client, identity.sub, CREDIT_GRANT_ACTION, key);

            if (prior?.status === 'succeeded') {
              // Replay: the money already moved. Returning the original result
              // is the whole point of the key.
              return json(event, 200, prior.after);
            }

            throw new HttpError(
              409,
              'CONFLICT',
              `An earlier attempt with this key is ${String(prior?.status ?? 'unknown')}; use a new Idempotency-Key`
            );
          }
          throw error;
        }

        await client.query('BEGIN');

        try {
          const subscription = await lockSubscription(client, userId);
          if (!subscription) {
            throw new HttpError(409, 'CONFLICT', 'User has no subscription to credit');
          }

          const balanceAfter = await addCredits(client, {
            userId,
            amount: input.amount,
            auditId,
            // Fixed vocabulary: this reason identifies an operator adjustment in
            // the ledger, distinct from plan allowances and purchases.
            reason: 'admin_credit_grant',
          });

          await client.query('COMMIT');

          // Completion happens after the money is committed: if this update
          // fails, the row stays `pending` and shows up in the audit viewer.
          await completeAudit(client, auditId, {
            status: 'succeeded',
            after: {
              amount: input.amount,
              balanceBefore: subscription.creditsRemaining,
              balanceAfter,
            },
          });

          return json(event, 201, {
            userId,
            credited: input.amount,
            creditsRemaining: balanceAfter,
            auditId,
          });
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          await completeAudit(client, auditId, {
            status: 'failed',
            error: (error as Error).message,
          }).catch(() => undefined);
          throw error;
        }
      });
    },
  },
  {
    method: 'POST',
    path: '/admin/users/{id}/status',
    minimumRole: 'admin',
    handler: async ({ event, identity, params }: RouteContext) => {
      const userId = userIdParam(params);
      const input = parseBody(statusChangeSchema, event.body);

      return withClient(async (client) => {
        const target = await client.query(
          'SELECT id, status, cognito_sub AS "cognitoSub" FROM users WHERE id = $1 LIMIT 1',
          [userId]
        );

        if (target.rows.length === 0) {
          throw new HttpError(404, 'NOT_FOUND', 'User not found');
        }

        // Locking yourself out is never the intent, and it cannot be undone from
        // inside the portal.
        if (target.rows[0].cognitoSub === identity.sub) {
          throw new HttpError(409, 'CONFLICT', 'You cannot change your own account status');
        }

        const previous = target.rows[0].status as string;

        const result = await withAudit(
          client,
          {
            actor: identity,
            action: STATUS_CHANGE_ACTION,
            targetType: 'user',
            targetId: userId,
            reason: input.reason,
            before: { status: previous },
            ip: event.requestContext?.identity?.sourceIp ?? null,
            userAgent: event.headers?.['user-agent'] ?? event.headers?.['User-Agent'] ?? null,
            requestId: event.requestContext?.requestId ?? null,
            idempotencyKey: idempotencyKey(event.headers),
          },
          async () => {
            await client.query('UPDATE users SET status = $2 WHERE id = $1', [userId, input.status]);

            // Suspending stops new trading immediately by pausing open sessions.
            // Positions are left alone: force-exiting someone's money is a
            // separate, deliberate action (the kill switch), not a side effect
            // of a support status change.
            let pausedSessions = 0;
            if (input.status !== 'active') {
              const paused = await client.query(
                `UPDATE portfolio_manager_sessions
                 SET status = 'paused'
                 WHERE user_id = $1 AND status = 'active'
                 RETURNING id`,
                [userId]
              );
              pausedSessions = paused.rowCount ?? 0;
            }

            return {
              result: {
                userId,
                status: input.status,
                previousStatus: previous,
                pausedSessions,
                // Reinstating access does not restart trading: resuming is a
                // separate decision with its own risk check.
                sessionsAutoResumed: false,
              },
              after: { status: input.status, previousStatus: previous, pausedSessions },
            };
          }
        );

        return json(event, 200, result);
      });
    },
  },
  {
    method: 'POST',
    path: '/admin/users/{id}/plan-override',
    minimumRole: 'admin',
    handler: async ({ event, identity, params }: RouteContext) => {
      const userId = userIdParam(params);
      const input = parseBody(planOverrideSchema, event.body);
      const auditId = idempotencyKey(event.headers);

      return withClient(async (client) => {
        if (!(await userExists(client, userId))) {
          throw new HttpError(404, 'NOT_FOUND', 'User not found');
        }

        await client.query('BEGIN');

        let auditRowId = '';

        try {
          const subscription = await lockSubscription(client, userId);
          if (!subscription) {
            throw new HttpError(409, 'CONFLICT', 'User has no subscription to override');
          }

          const existing = await getActiveOverride(client, userId);

          auditRowId = await writeAuditLog(
            client,
            {
              actor: identity,
              action: PLAN_OVERRIDE_ACTION,
              targetType: 'user',
              targetId: userId,
              reason: input.reason,
              before: { plan: subscription.plan },
              requestId: event.requestContext?.requestId ?? null,
              ip: event.requestContext?.identity?.sourceIp ?? null,
              idempotencyKey: auditId,
            },
            // This route commits the audit row with the override: one atomic
            // unit, unlike the "audit first, then work" default.
            { inTransaction: true }
          );

          await grantOverride(client, {
            userId,
            plan: input.plan,
            expiresAt: input.expiresAt ? new Date(input.expiresAt).toISOString() : null,
            reason: input.reason,
            grantedBy: identity.email,
            currentPlan: subscription.plan,
            hadActiveOverride: existing !== null,
          });

          await completeAudit(client, auditRowId, {
            status: 'succeeded',
            after: { plan: input.plan, expiresAt: input.expiresAt ?? null },
          });

          await client.query('COMMIT');

          return json(event, 201, {
            userId,
            plan: input.plan,
            previousPlan: existing?.previousPlan ?? subscription.plan,
            expiresAt: input.expiresAt ?? null,
            renewalPaused: true,
          });
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          if (auditRowId) {
            await completeAudit(client, auditRowId, {
              status: 'failed',
              error: (error as Error).message,
            }).catch(() => undefined);
          }
          throw error;
        }
      });
    },
  },
  {
    method: 'DELETE',
    path: '/admin/users/{id}/plan-override',
    minimumRole: 'admin',
    handler: async ({ event, identity, params }: RouteContext) => {
      const userId = userIdParam(params);
      const input = parseBody(revokeSchema, event.body);

      return withClient(async (client) => {
        if (!(await userExists(client, userId))) {
          throw new HttpError(404, 'NOT_FOUND', 'User not found');
        }

        const result = await withAudit(
          client,
          {
            actor: identity,
            action: PLAN_REVOKE_ACTION,
            targetType: 'user',
            targetId: userId,
            reason: input.reason,
            requestId: event.requestContext?.requestId ?? null,
            ip: event.requestContext?.identity?.sourceIp ?? null,
          },
          async () => {
            const revoked = await revokeOverride(client, userId);
            return {
              result: { userId, restoredPlan: revoked.restoredPlan },
              after: { restoredPlan: revoked.restoredPlan },
            };
          }
        );

        return json(event, 200, result);
      });
    },
  },
];
