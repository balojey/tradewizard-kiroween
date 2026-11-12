/**
 * Copilot routes.
 *
 * Read-only by construction: every endpoint invokes `admin-copilot` with a role
 * and a context, and returns an answer plus links. There is no route that lets
 * the model act, and these requests are deliberately **not** written to the
 * mutation audit log — reading is not a mutation, and inflating the chain with
 * questions would make the ledger harder to read.
 *
 * See docs/plans/warden-ai-copilot.md §7.
 */

import { z } from 'zod';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { HttpError, json } from '../lib/responses';
import { enforceCopilotRateLimit } from '../lib/rate-limit';
import { parseBody } from '../lib/validation';
import type { AdminRoute, RouteContext } from '../lib/router';
import type { ErrorCode } from '../lib/types';
import type { AdminIdentity, AdminRole } from '../../shared/admin-auth';
import { getSetting } from '../../shared/settings';
import type {
  CopilotEnvelope,
  CopilotKind,
  CopilotRequest,
  CopilotResponse,
} from '../../admin-copilot/types';

const lambda = new LambdaClient({});

const uuid = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid id');

const optionalDate = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date')
  .optional();

const question = z.string().trim().max(600, 'Question is too long').optional();

const incidentSchema = z.object({
  question,
  from: optionalDate,
  to: optionalDate,
  targetType: z.string().trim().max(60).optional(),
  targetId: z.string().trim().max(200).optional(),
});

const supportSchema = z.object({
  ticketId: uuid,
  mode: z.enum(['summary', 'draft_reply']),
});

const analysisSchema = z.object({
  analysisId: uuid,
  question,
});

const sessionSchema = z.object({
  sessionId: uuid,
  question,
});

const riskBriefSchema = z.object({
  action: z.string().trim().min(3, 'Action is required').max(120),
  targetType: z.string().trim().max(60).optional(),
  targetId: z.string().trim().max(200).optional(),
  userId: uuid.optional(),
  sessionId: uuid.optional(),
  payload: z.unknown().optional(),
});

/** Envelope code → HTTP status. Anything unmapped is a server fault. */
const STATUS: Record<string, number> = {
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  COPILOT_DISABLED: 503,
  UPSTREAM_FAILED: 502,
  INTERNAL: 500,
};

async function copilotEnabled(): Promise<boolean> {
  const value = await getSetting('copilot_enabled');
  return value === true || value === 'true';
}

/** 503 rather than 403: the feature is off, the operator is not forbidden. */
async function assertEnabled(): Promise<void> {
  if (!(await copilotEnabled())) {
    throw new HttpError(
      503,
      'COPILOT_DISABLED',
      'The copilot is switched off. An owner can re-enable it in Runtime settings.'
    );
  }
}

async function invokeCopilot(
  identity: AdminIdentity,
  kind: CopilotKind,
  body: Omit<CopilotRequest, 'kind' | 'context'> & {
    question?: string;
    context?: Partial<CopilotRequest['context']>;
  }
): Promise<CopilotResponse> {
  await enforceCopilotRateLimit(identity);

  const functionName = process.env.COPILOT_FUNCTION_NAME;
  if (!functionName) {
    throw new HttpError(500, 'INTERNAL', 'Copilot function is not configured.');
  }

  const request: CopilotRequest = {
    kind,
    question: body.question,
    mode: body.mode,
    context: {
      // Identity last: a body can never override the caller's role or sub.
      ...body.context,
      role: identity.role as AdminRole,
      actorSub: identity.sub,
    },
  };

  const startedAt = Date.now();
  let payload: string;

  try {
    const response = await lambda.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify(request),
      })
    );

    if (response.FunctionError) {
      throw new Error(`Copilot function failed: ${response.FunctionError}`);
    }

    payload = response.Payload
      ? Buffer.from(response.Payload).toString('utf-8')
      : '';
  } catch (error) {
    console.error(
      JSON.stringify({
        metric: 'AdminCopilotInvokeError',
        surface: kind,
        error: (error as Error).message,
      })
    );

    throw new HttpError(
      502,
      'UPSTREAM_FAILED',
      'The copilot did not respond. The portal still works; retry once.'
    );
  }

  let envelope: CopilotEnvelope;
  try {
    envelope = JSON.parse(payload) as CopilotEnvelope;
  } catch {
    throw new HttpError(502, 'UPSTREAM_FAILED', 'The copilot returned an unreadable answer.');
  }

  if (!envelope || envelope.ok !== true) {
    const code = envelope && envelope.ok === false ? envelope.code : 'INTERNAL';
    const message =
      envelope && envelope.ok === false
        ? envelope.message
        : 'The copilot returned an unreadable answer.';

    throw new HttpError(STATUS[code] ?? 500, code as ErrorCode, message);
  }

  // Metadata only: no question, no answer, no record content.
  console.log(
    JSON.stringify({
      metric: 'AdminCopilotRequest',
      surface: kind,
      role: identity.role,
      actorPrefix: identity.sub.slice(0, 8),
      latencyMs: Date.now() - startedAt,
      citations: envelope.response.citations.length,
      suggestedActions: envelope.response.suggestedActions.length,
      confidence: envelope.response.confidence,
      inputTokens: envelope.response.usage?.inputTokens ?? null,
      outputTokens: envelope.response.usage?.outputTokens ?? null,
      estimatedCostUsd: envelope.response.usage?.estimatedCostUsd ?? null,
      model: envelope.response.model,
    })
  );

  return envelope.response;
}

export const copilotRoutes: AdminRoute[] = [
  {
    // A cheap capability probe so the UI can hide every Ask Warden panel when
    // the feature is switched off, without granting analysts `settings` read.
    method: 'GET',
    path: '/admin/copilot/status',
    minimumRole: 'analyst',
    handler: async ({ event }: RouteContext) => {
      return json(event, 200, { enabled: await copilotEnabled() });
    },
  },
  {
    method: 'POST',
    path: '/admin/copilot/incident',
    minimumRole: 'analyst',
    handler: async ({ event, identity }: RouteContext) => {
      await assertEnabled();

      const body = parseBody(incidentSchema, event.body);

      const response = await invokeCopilot(identity, 'incident', {
        question: body.question,
        context: {
          from: body.from,
          to: body.to,
          targetType: body.targetType,
          targetId: body.targetId,
        },
      });

      return json(event, 200, response);
    },
  },
  {
    method: 'POST',
    path: '/admin/copilot/support',
    minimumRole: 'support',
    handler: async ({ event, identity }: RouteContext) => {
      await assertEnabled();

      const body = parseBody(supportSchema, event.body);

      const response = await invokeCopilot(identity, 'support', {
        mode: body.mode,
        question:
          body.mode === 'draft_reply'
            ? 'Write the reply to this ticket.'
            : 'Summarise this ticket: the issue, the customer context, and what the operator should check next.',
        context: { ticketId: body.ticketId },
      });

      return json(event, 200, response);
    },
  },
  {
    method: 'POST',
    path: '/admin/copilot/analysis',
    minimumRole: 'analyst',
    handler: async ({ event, identity }: RouteContext) => {
      await assertEnabled();

      const body = parseBody(analysisSchema, event.body);

      const response = await invokeCopilot(identity, 'analysis', {
        question:
          body.question ||
          'Explain this verdict. If it was NO_TRADE, name the dissenting agents and the gate that produced it.',
        context: { analysisId: body.analysisId },
      });

      return json(event, 200, response);
    },
  },
  {
    method: 'POST',
    path: '/admin/copilot/session',
    minimumRole: 'support',
    handler: async ({ event, identity }: RouteContext) => {
      await assertEnabled();

      const body = parseBody(sessionSchema, event.body);

      const response = await invokeCopilot(identity, 'session', {
        question:
          body.question ||
          'Explain this session: what it did, why it entered or exited, and what happened before the exit.',
        context: { sessionId: body.sessionId },
      });

      return json(event, 200, response);
    },
  },
  {
    method: 'POST',
    path: '/admin/copilot/risk-brief',
    minimumRole: 'admin',
    handler: async ({ event, identity }: RouteContext) => {
      await assertEnabled();

      const body = parseBody(riskBriefSchema, event.body);

      const response = await invokeCopilot(identity, 'risk_brief', {
        question:
          'Summarise the blast radius of this action, the recent related actions, and what could go wrong. Do not tell me to proceed; name the control I would use.',
        context: {
          action: body.action,
          targetType: body.targetType,
          targetId: body.targetId,
          userId: body.userId,
          sessionId: body.sessionId,
          payload: body.payload,
        },
      });

      return json(event, 200, response);
    },
  },
];
