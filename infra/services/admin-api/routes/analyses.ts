/**
 * Analysis routes: the execution log, a single execution with its payload, and
 * bounded quality aggregates.
 *
 * Route order matters: `/admin/analyses/quality` is registered before
 * `/admin/analyses/{id}` so the literal path wins.
 */

import { writeAuditLog, completeAudit } from '../lib/audit';
import { withClient } from '../lib/db';
import { checkInFlight, deleteDedupCache, markInFlight } from '../../shared/dynamo';
import { getUserIdByCognitoSub } from '../../shared/db';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { refundResultDeliveries } from '../queries/credits';
import { revokeSchema } from '../lib/validation';
import { parseBody, requeueSchema } from '../lib/validation';
import { parsePagination, toPage } from '../lib/pagination';
import { HttpError, json } from '../lib/responses';
import { PAYLOAD_URL_TTL_SECONDS, presignPayloadUrl } from '../lib/s3';
import { parseOptionalDate, parseWindow } from '../lib/window';
import type { AdminRoute, RouteContext } from '../lib/router';
import * as queries from '../queries/analyses';

const sqs = new SQSClient({});

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RECOMMENDATIONS = ['LONG_YES', 'LONG_NO', 'NO_TRADE'];
const OUTCOMES = ['pending', 'success', 'failure', 'expired', 'no_trade'];
function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function allowlisted(
  raw: string | null | undefined,
  allowed: string[],
  name: string
): string | null {
  if (!raw) return null;
  if (!allowed.includes(raw)) {
    throw new HttpError(400, 'BAD_REQUEST', `Invalid ${name}: ${raw}`);
  }
  return raw;
}

function analysisIdParam(params: Record<string, string>): string {
  const id = params.id;
  if (!id || !UUID_PATTERN.test(id)) {
    throw new HttpError(400, 'BAD_REQUEST', 'Invalid analysis id');
  }
  return id;
}

export const analysesRoutes: AdminRoute[] = [
  {
    method: 'GET',
    path: '/admin/analyses',
    minimumRole: 'analyst',
    handler: async ({ event }: RouteContext) => {
      const params = event.queryStringParameters ?? {};
      const { limit, cursor } = parsePagination(params);

      const userId = params.userId ?? null;
      if (userId && !UUID_PATTERN.test(userId)) {
        throw new HttpError(400, 'BAD_REQUEST', 'Invalid userId');
      }

      const filters = {
        marketId: params.marketId?.trim() || null,
        userId,
        recommendation: allowlisted(params.recommendation, RECOMMENDATIONS, 'recommendation'),
        outcome: allowlisted(params.outcome, OUTCOMES, 'outcome'),
        noTradeReason: params.noTradeReason?.trim() || null,
        from: parseOptionalDate(params.from, 'from'),
        to: parseOptionalDate(params.to, 'to'),
      };

      return withClient(async (client) => {
        const rows = await queries.listAnalyses(client, filters, limit, cursor);
        const page = toPage(rows, limit, (row) => ({
          createdAt: iso(row.executedAt),
          id: String(row.id),
        }));

        return json(event, 200, page.items, { nextCursor: page.nextCursor });
      });
    },
  },
  {
    method: 'GET',
    path: '/admin/analyses/quality',
    minimumRole: 'analyst',
    handler: async ({ event }: RouteContext) => {
      const window = parseWindow(event.queryStringParameters);

      return withClient(async (client) => {
        const report = await queries.getQualityReport(client, window);
        return json(event, 200, report);
      });
    },
  },
  {
    method: 'GET',
    path: '/admin/analyses/{id}',
    minimumRole: 'analyst',
    handler: async ({ event, params }: RouteContext) => {
      const analysisId = analysisIdParam(params);

      return withClient(async (client) => {
        const row = await queries.getAnalysisById(client, analysisId);
        if (!row) {
          throw new HttpError(404, 'NOT_FOUND', 'Analysis not found');
        }

        const { payloadKey, ...analysis } = row as Record<string, unknown> & {
          payloadKey?: string;
        };

        // Presign after the row is found: no point signing a key that does not
        // exist, and a missing key is a data defect worth surfacing.
        const payloadUrl = payloadKey ? await presignPayloadUrl(payloadKey) : null;

        return json(event, 200, {
          ...analysis,
          payloadUrl,
          payloadUrlExpiresInSeconds: payloadUrl ? PAYLOAD_URL_TTL_SECONDS : 0,
        });
      });
    },
  },
  {
    method: 'POST',
    path: '/admin/analyses/{id}/invalidate-cache',
    minimumRole: 'admin',
    handler: async ({ event, identity, params }: RouteContext) => {
      const analysisId = analysisIdParam(params);
      const input = parseBody(revokeSchema, event.body);

      return withClient(async (client) => {
        const marketId = await queries.getAnalysisMarketId(client, analysisId);
        if (!marketId) {
          throw new HttpError(404, 'NOT_FOUND', 'Analysis not found');
        }

        const auditId = await writeAuditLog(client, {
          actor: identity,
          action: 'analysis.cache.invalidate',
          targetType: 'analysis',
          targetId: analysisId,
          reason: input.reason,
          before: { marketId },
          requestId: event.requestContext?.requestId ?? null,
          ip: event.requestContext?.identity?.sourceIp ?? null,
        });

        try {
          // DynamoDB, not SQL: the cache lives in the dedup table.
          const deleted = await deleteDedupCache(marketId);

          await completeAudit(client, auditId, {
            status: 'succeeded',
            after: { marketId, deletedEntries: deleted },
          });

          return json(event, 200, { analysisId, marketId, deletedEntries: deleted });
        } catch (error) {
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
    path: '/admin/analyses/{id}/refund',
    minimumRole: 'admin',
    handler: async ({ event, identity, params }: RouteContext) => {
      const analysisId = analysisIdParam(params);
      const input = parseBody(revokeSchema, event.body);

      return withClient(async (client) => {
        const marketId = await queries.getAnalysisMarketId(client, analysisId);
        if (!marketId) {
          throw new HttpError(404, 'NOT_FOUND', 'Analysis not found');
        }

        const auditId = await writeAuditLog(client, {
          actor: identity,
          action: 'analysis.refund',
          targetType: 'analysis',
          targetId: analysisId,
          reason: input.reason,
          before: { marketId },
          requestId: event.requestContext?.requestId ?? null,
          ip: event.requestContext?.identity?.sourceIp ?? null,
        });

        await client.query('BEGIN');

        try {
          const outcome = await refundResultDeliveries(client, analysisId, identity.email);
          await client.query('COMMIT');

          await completeAudit(client, auditId, {
            status: 'succeeded',
            after: { marketId, ...outcome },
          });

          return json(event, 200, { analysisId, marketId, ...outcome });
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
    path: '/admin/analyses/requeue',
    minimumRole: 'admin',
    handler: async ({ event, identity }: RouteContext) => {
      const input = parseBody(requeueSchema, event.body);
      const queueUrl = process.env.ANALYSIS_QUEUE_URL;
      if (!queueUrl) {
        throw new HttpError(500, 'INTERNAL', 'ANALYSIS_QUEUE_URL is not configured');
      }

      // Refuse to stack a second run on one already in flight: the in-flight
      // marker is what keeps the pool at one execution per market.
      const inFlight = await checkInFlight(input.marketId);
      if (inFlight) {
        throw new HttpError(
          409,
          'CONFLICT',
          `An analysis for this market is already running (request ${inFlight}).`
        );
      }

      const requestId = crypto.randomUUID();

      // We act as a scheduled fire, not as a user request: this is the mechanism
      // that stops the orchestrator from adding the requesting account to the
      // delivery targets, so nobody is charged for an operator-triggered run.
      const actorUserId = await getUserIdByCognitoSub(identity.sub);
      if (!actorUserId) {
        throw new HttpError(
          409,
          'CONFLICT',
          'Your admin account has no linked product user, so the pipeline cannot attribute the run'
        );
      }

      await markInFlight(input.marketId, requestId);

      try {
        await sqs.send(
          new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify({
              marketId: input.marketId,
              userId: actorUserId,
              requestType: 'recurring',
              isScheduledFire: true,
              scheduledFireId: `admin-${requestId}`,
            }),
            MessageGroupId: input.marketId,
            MessageDeduplicationId: requestId,
          })
        );
      } catch (error) {
        // Leave no stale marker blocking the market for five minutes.
        const { clearInFlight } = await import('../../shared/dynamo');
        await clearInFlight(input.marketId).catch(() => undefined);
        throw error;
      }

      return withClient(async (client) => {
        const auditId = await writeAuditLog(client, {
          actor: identity,
          action: 'analysis.requeue',
          targetType: 'market',
          targetId: input.marketId,
          reason: input.reason,
          requestId: event.requestContext?.requestId ?? null,
          ip: event.requestContext?.identity?.sourceIp ?? null,
        });

        await completeAudit(client, auditId, {
          status: 'succeeded',
          after: { requestId, mode: 'scheduled_fire' },
        });

        return json(event, 202, {
          marketId: input.marketId,
          requestId,
          note: 'Analysis dispatched. Subscribers will be charged as usual if they receive it.',
        });
      });
    },
  },
];
