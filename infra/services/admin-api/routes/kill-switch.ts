/**
 * Admin kill switch.
 *
 * Two-phase on purpose:
 *
 * 1. **Halt synchronously.** `activateUser` writes the kill-switch state, which
 *    every trading path checks, so new entries stop immediately and the caller
 *    gets a definite answer.
 * 2. **Exit asynchronously.** Cancelling orders and exiting positions needs CLOB
 *    credentials and up to a minute per session, so it is dispatched to the risk
 *    engine (which owns that code and its failure state) as an Event invocation.
 *    A failure there leaves the halt in place, which is the safe direction.
 *
 * Scope: per-user. A platform-wide halt needs the risk engine to iterate every
 * user's sessions, which deserves its own reviewed change.
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { writeAuditLog, completeAudit } from '../lib/audit';
import { withClient } from '../lib/db';
import { HttpError, json } from '../lib/responses';
import { parseBody } from '../lib/validation';
import type { AdminRoute, RouteContext } from '../lib/router';
import { z } from 'zod';
import { activateUser, resetUser } from '../../shared/kill-switch';
import { requireFreshAuth } from '../../shared/admin-auth';

const lambda = new LambdaClient({});

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const killSwitchSchema = z.object({
  userId: z.string().regex(UUID_PATTERN, 'Invalid userId'),
  reason: z.string().trim().min(8, 'Reason must be at least 8 characters').max(500),
});

type DispatchOutcome = 'sent' | 'failed';

async function dispatchHalt(userId: string, reason: string): Promise<DispatchOutcome> {
  const functionName = process.env.RISK_ENGINE_FUNCTION_NAME;
  if (!functionName) {
    console.error('Kill switch: RISK_ENGINE_FUNCTION_NAME is not configured');
    return 'failed';
  }

  try {
    await lambda.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ action: 'halt_sessions', userId, reason })),
      })
    );
    return 'sent';
  } catch (error) {
    // The halt already stands; the exit can be retried by an operator.
    console.error('Kill switch: failed to dispatch the exit', error);
    return 'failed';
  }
}

export const killSwitchRoutes: AdminRoute[] = [
  {
    method: 'POST',
    path: '/admin/portfolio/kill-switch',
    minimumRole: 'admin',
    handler: async ({ event, identity }: RouteContext) => {
      requireFreshAuth(identity);
      const input = parseBody(killSwitchSchema, event.body);

      return withClient(async (client) => {
        const user = await client.query('SELECT id FROM users WHERE id = $1 LIMIT 1', [input.userId]);
        if (user.rows.length === 0) {
          throw new HttpError(404, 'NOT_FOUND', 'User not found');
        }

        // Phase 1: halt. Throws if the state cannot be persisted, which is the
        // correct failure mode — never report a halt that did not happen.
        const state = await activateUser(input.userId, {
          reason: input.reason,
          actor: `admin:${identity.sub}`,
        });

        // Phase 2: exit. Best effort by design.
        const dispatch = await dispatchHalt(input.userId, input.reason);

        const auditId = await writeAuditLog(client, {
          actor: identity,
          action: 'portfolio.kill_switch.activate',
          targetType: 'user',
          targetId: input.userId,
          reason: input.reason,
          before: { killSwitchActive: false },
          requestId: event.requestContext?.requestId ?? null,
          ip: event.requestContext?.identity?.sourceIp ?? null,
        });

        await completeAudit(client, auditId, {
          status: 'succeeded',
          after: { activatedAt: state.triggeredAt, dispatch },
        });

        return json(event, 202, {
          userId: input.userId,
          halted: true,
          activatedAt: state.triggeredAt,
          exitsDispatched: dispatch === 'sent',
          note:
            dispatch === 'sent'
              ? 'New entries are blocked; positions are being exited in the background.'
              : 'New entries are blocked, but the exit dispatch failed. Retry or exit manually.',
        });
      });
    },
  },
  {
    method: 'DELETE',
    path: '/admin/portfolio/kill-switch',
    minimumRole: 'admin',
    handler: async ({ event, identity }: RouteContext) => {
      requireFreshAuth(identity);
      const input = parseBody(killSwitchSchema, event.body);

      return withClient(async (client) => {
        await resetUser(input.userId);

        const auditId = await writeAuditLog(client, {
          actor: identity,
          action: 'portfolio.kill_switch.reset',
          targetType: 'user',
          targetId: input.userId,
          reason: input.reason,
          before: { killSwitchActive: true },
          requestId: event.requestContext?.requestId ?? null,
          ip: event.requestContext?.identity?.sourceIp ?? null,
        });

        await completeAudit(client, auditId, {
          status: 'succeeded',
          after: { killSwitchActive: false },
        });

        return json(event, 200, {
          userId: input.userId,
          halted: false,
          note: 'Trading may resume. Paused sessions still need to be resumed explicitly.',
        });
      });
    },
  },
];
