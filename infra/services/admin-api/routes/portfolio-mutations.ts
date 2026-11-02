/**
 * Portfolio session controls.
 *
 * Pause and resume only change scheduling; they never place or exit orders. The
 * destructive controls (terminate, kill switch) live in their own slices.
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { withAudit, writeAuditLog, completeAudit } from '../lib/audit';
import { withClient } from '../lib/db';
import { HttpError, json } from '../lib/responses';
import { parseBody, revokeSchema } from '../lib/validation';
import type { AdminRoute, RouteContext } from '../lib/router';
import { getSessionState } from '../queries/portfolio';
import { cancelPendingOrders } from '../../shared/portfolio-orders';
import { isHalted } from '../../shared/kill-switch';

const lambda = new LambdaClient({});

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sessionIdParam(params: Record<string, string>): string {
  const id = params.id;
  if (!id || !UUID_PATTERN.test(id)) {
    throw new HttpError(400, 'BAD_REQUEST', 'Invalid session id');
  }
  return id;
}

export const portfolioMutationRoutes: AdminRoute[] = [
  {
    method: 'POST',
    path: '/admin/portfolio/sessions/{id}/pause',
    minimumRole: 'support',
    handler: async ({ event, identity, params }: RouteContext) => {
      const sessionId = sessionIdParam(params);
      const input = parseBody(revokeSchema, event.body);

      return withClient(async (client) => {
        const session = await getSessionState(client, sessionId);
        if (!session) throw new HttpError(404, 'NOT_FOUND', 'Session not found');
        if (session.status !== 'active') {
          throw new HttpError(409, 'CONFLICT', `Only active sessions can be paused (currently ${session.status})`);
        }

        const result = await withAudit(
          client,
          {
            actor: identity,
            action: 'portfolio.session.pause',
            targetType: 'portfolio_session',
            targetId: sessionId,
            reason: input.reason,
            before: { status: session.status },
            requestId: event.requestContext?.requestId ?? null,
            ip: event.requestContext?.identity?.sourceIp ?? null,
          },
          async () => {
            // Pending orders keep working at the exchange unless cancelled, and a
            // paused session would not manage the fills.
            const cancelled = await cancelPendingOrders(client, sessionId);

            await client.query(
              `UPDATE portfolio_manager_sessions SET status = 'paused', updated_at = now() WHERE id = $1`,
              [sessionId]
            );

            return {
              result: { sessionId, status: 'paused', ...cancelled },
              after: { status: 'paused', ...cancelled },
            };
          }
        );

        return json(event, 200, result);
      });
    },
  },
  {
    method: 'POST',
    path: '/admin/portfolio/sessions/{id}/resume',
    minimumRole: 'support',
    handler: async ({ event, identity, params }: RouteContext) => {
      const sessionId = sessionIdParam(params);
      const input = parseBody(revokeSchema, event.body);

      return withClient(async (client) => {
        const session = await getSessionState(client, sessionId);
        if (!session) throw new HttpError(404, 'NOT_FOUND', 'Session not found');
        if (session.status !== 'paused') {
          throw new HttpError(409, 'CONFLICT', `Only paused sessions can be resumed (currently ${session.status})`);
        }

        // Two guards that the product's resume path also enforces, plus the
        // account status, because a suspended user must not trade.
        if (session.accountStatus && session.accountStatus !== 'active') {
          throw new HttpError(409, 'CONFLICT', 'The account is suspended; reinstate it first');
        }
        if (await isHalted(session.userId)) {
          throw new HttpError(
            409,
            'CONFLICT',
            'A kill switch is active for this user; reset it before resuming'
          );
        }

        const result = await withAudit(
          client,
          {
            actor: identity,
            action: 'portfolio.session.resume',
            targetType: 'portfolio_session',
            targetId: sessionId,
            reason: input.reason,
            before: { status: session.status },
            requestId: event.requestContext?.requestId ?? null,
            ip: event.requestContext?.identity?.sourceIp ?? null,
          },
          async () => {
            await client.query(
              `UPDATE portfolio_manager_sessions SET status = 'active', updated_at = now() WHERE id = $1`,
              [sessionId]
            );
            return {
              result: { sessionId, status: 'active' },
              after: { status: 'active' },
            };
          }
        );

        return json(event, 200, result);
      });
    },
  },
  {
    method: 'POST',
    path: '/admin/portfolio/sessions/{id}/terminate',
    minimumRole: 'admin',
    handler: async ({ event, identity, params }: RouteContext) => {
      const sessionId = sessionIdParam(params);
      const input = parseBody(revokeSchema, event.body);

      return withClient(async (client) => {
        const session = await getSessionState(client, sessionId);
        if (!session) throw new HttpError(404, 'NOT_FOUND', 'Session not found');
        if (session.status === 'terminated' || session.status === 'completed') {
          throw new HttpError(409, 'CONFLICT', `Session is already ${session.status}`);
        }

        const auditId = await writeAuditLog(client, {
          actor: identity,
          action: 'portfolio.session.terminate',
          targetType: 'portfolio_session',
          targetId: sessionId,
          reason: input.reason,
          before: { status: session.status },
          requestId: event.requestContext?.requestId ?? null,
          ip: event.requestContext?.identity?.sourceIp ?? null,
        });

        // The exit happens in the risk engine: it owns the CLOB escalation and
        // may take a minute, so the request does not wait for it.
        let dispatch: 'sent' | 'failed' = 'failed';
        const functionName = process.env.RISK_ENGINE_FUNCTION_NAME;

        if (functionName) {
          try {
            await lambda.send(
              new InvokeCommand({
                FunctionName: functionName,
                InvocationType: 'Event',
                Payload: Buffer.from(
                  JSON.stringify({
                    action: 'terminate_session',
                    sessionId,
                    reason: input.reason,
                  })
                ),
              })
            );
            dispatch = 'sent';
          } catch (error) {
            console.error('Terminate: failed to dispatch the exit', error);
          }
        }

        await completeAudit(client, auditId, {
          status: dispatch === 'sent' ? 'succeeded' : 'failed',
          after: { dispatch },
          error: dispatch === 'sent' ? null : 'Exit dispatch failed',
        });

        return json(event, 202, {
          sessionId,
          exitsDispatched: dispatch === 'sent',
          note:
            dispatch === 'sent'
              ? 'Session termination and position exit are running in the background.'
              : 'Termination could not be dispatched. Retry, or use the kill switch.',
        });
      });
    },
  },
];
