/**
 * Support API — public ticket intake and thread access.
 *
 * Routes:
 *   POST /support/tickets                    submit (anonymous allowed)
 *   GET  /support/tickets                    "my tickets" (Cognito)
 *   GET  /support/tickets/{ref}              thread (token or signed-in owner)
 *   POST /support/tickets/{ref}/messages     customer reply (token or owner)
 *
 * The two public routes are `AuthorizationType.NONE` at API Gateway so that an
 * anonymous requester can submit. Identity, when present, is verified here — see
 * lib/auth.ts. The access token is a credential: stored hashed, compared in
 * constant time, never returned after creation.
 *
 * See docs/support-tickets-plan.md §4.
 */

import type { Client } from 'pg';
import type { z } from 'zod';
import { getUserIdByCognitoSub } from '../shared/db';
import { getSettingSync, warmSettings } from '../shared/settings';
import { authorizerSub, readBearerIdentity } from './lib/auth';
import { withClient } from './lib/db';
import {
  errorResponse,
  HttpError,
  json,
  preflight,
  type ApiResponse,
} from './lib/http';
import { enforceMessageLimit, enforceSubmitLimits } from './lib/limits';
import { sendSupportAcknowledgement } from '../shared/support-email';
import * as queries from './lib/queries';
import { hashIp } from './lib/tokens';
import { hasValidThreadToken, issueThreadToken } from '../shared/support-tickets';
import {
  contextHash,
  normaliseContext,
  postMessageSchema,
  submitTicketSchema,
} from './lib/validation';

interface SupportApiEvent {
  httpMethod: string;
  path: string;
  headers?: Record<string, string | undefined>;
  body: string | null;
  queryStringParameters?: Record<string, string | null> | null;
  requestContext?: {
    authorizer?: { claims?: Record<string, string> | null } | null;
    identity?: { sourceIp?: string } | null;
  };
}

export async function handler(event: SupportApiEvent): Promise<ApiResponse> {
  try {
    if (event.httpMethod === 'OPTIONS') return preflight();

    const path = event.path.replace(/\/+$/, '');
    const method = event.httpMethod.toUpperCase();

    if (path === '/support/tickets' && method === 'POST') {
      return await handleSubmit(event);
    }
    if (path === '/support/tickets' && method === 'GET') {
      return await handleListMine(event);
    }

    const messageMatch = path.match(/^\/support\/tickets\/([^/]+)\/messages$/);
    if (messageMatch && method === 'POST') {
      return await handlePostMessage(event, decodeURIComponent(messageMatch[1]));
    }

    const threadMatch = path.match(/^\/support\/tickets\/([^/]+)$/);
    if (threadMatch && method === 'GET') {
      return await handleThread(event, decodeURIComponent(threadMatch[1]));
    }

    throw new HttpError(404, 'NOT_FOUND', 'Unknown support route.');
  } catch (caught) {
    if (caught instanceof HttpError) return errorResponse(caught);

    console.error('SupportApi error', caught);
    return errorResponse(
      new HttpError(500, 'INTERNAL_ERROR', 'Something went wrong on our side.')
    );
  }
}

// ─── Submit ─────────────────────────────────────────────────────────────────────

async function handleSubmit(event: SupportApiEvent): Promise<ApiResponse> {
  const input = parseOrThrow(submitTicketSchema, readJson(event));
  const context = normaliseContext(input.context);
  const fingerprint = contextHash(context);

  await assertSupportEnabled();

  // Identity is optional here: a stale token must not block someone asking for
  // help, and an anonymous requester is a supported case, not a fallback.
  const identity = await readBearerIdentity(event);

  // A signed-in requester is never asked for an address: the token's email is
  // verified, so it wins over whatever the form posted. This also stops a typo
  // from filing the ticket under an address they cannot open.
  const requesterEmail = identity?.email?.trim().toLowerCase() || input.email;

  await enforceSubmitLimits(requesterEmail, event.requestContext?.identity?.sourceIp ?? '');

  const ipHash = await hashIp(event.requestContext?.identity?.sourceIp ?? '');

  const outcome = await withClient(async (client) => {
    if (input.requestId) {
      const existing = await queries.findTicketByRequestId(
        client,
        requesterEmail,
        input.requestId
      );
      if (existing) return { existing };
    }

    const duplicate = await queries.findRecentDuplicate(client, requesterEmail, fingerprint);
    if (duplicate) return { existing: duplicate };

    let userId = identity ? await getUserIdByCognitoSub(identity.sub) : null;
    if (!userId) {
      // Silent link (decision 2): support sees the account, the caller learns
      // nothing about whether that email has one.
      userId = await queries.findUserIdByEmail(client, requesterEmail);
    }

    const created = await queries.insertTicket(client, {
      email: requesterEmail,
      userId,
      topic: input.topic,
      subject: input.subject,
      body: input.body,
      context,
      contextHash: fingerprint,
      appVersion: context.appVersion ?? null,
      requestId: input.requestId ?? null,
      ipHash,
    });

    // Lost a race on the idempotency key: read the winner instead of failing.
    if (!created) {
      const existing = input.requestId
        ? await queries.findTicketByRequestId(client, requesterEmail, input.requestId)
        : null;
      if (existing) return { existing };
      throw new HttpError(500, 'INTERNAL_ERROR', 'Could not create the request.');
    }

    return { created };
  });

  if (outcome.created) {
    const delivered = await deliverAcknowledgement(
      outcome.created.ref,
      outcome.created.accessToken,
      requesterEmail,
      input.subject,
      outcome.created.id
    );

    if (!delivered) {
      throw new HttpError(
        502,
        'EMAIL_FAILED',
        'Your request was saved, but we could not email the confirmation. Please try again.',
        { ref: outcome.created.ref, retryable: true }
      );
    }

    return json(201, { ref: outcome.created.ref, emailSent: true });
  }

  // Duplicate: return the same ref. If the first acknowledgement never went out,
  // this is also the resend path, so rotate the token (only the hash is stored).
  const existing = outcome.existing;
  if (!existing) {
    throw new HttpError(500, 'INTERNAL_ERROR', 'Could not load the existing request.');
  }

  if (existing.confirmation_sent) {
    return json(200, { ref: existing.ref, emailSent: true, duplicate: true });
  }

  const refreshed = await withClient(async (client) => ({
    token: await issueThreadToken(client, existing.id),
    id: existing.id,
  }));

  const delivered = await deliverAcknowledgement(
    existing.ref,
    refreshed.token,
    requesterEmail,
    existing.subject,
    existing.id
  );

  if (!delivered) {
    throw new HttpError(
      502,
      'EMAIL_FAILED',
      'Your request is saved, but we could not email the confirmation. Please try again.',
      { ref: existing.ref, retryable: true }
    );
  }

  return json(200, { ref: existing.ref, emailSent: true, duplicate: true });
}

async function deliverAcknowledgement(
  ref: string,
  token: string,
  email: string,
  subject: string,
  ticketId: string
): Promise<boolean> {
  try {
    await sendSupportAcknowledgement({ to: email, ref, token, subject });
    await withClient((client) => queries.markConfirmationSent(client, ticketId));
    return true;
  } catch (caught) {
    // The ticket exists and is visible to support; the caller can retry with the
    // same requestId and this path resends.
    console.error('Support acknowledgement failed', { ref, caught });
    return false;
  }
}

// ─── Thread access ─────────────────────────────────────────────────────────────

async function handleThread(event: SupportApiEvent, ref: string): Promise<ApiResponse> {
  const identity = await readBearerIdentity(event);

  const ticket = await withClient(async (client) => {
    const found = await queries.getTicketByRef(client, ref);
    if (!found) return null;

    return (await authoriseThread(event, client, found, identity)) ? found : null;
  });

  if (!ticket) throw notFound();

  const messages = await withClient((client) => queries.listMessages(client, ticket.id));

  return json(200, {
    ticket: {
      ref: ticket.ref,
      topic: ticket.topic,
      status: ticket.status,
      subject: ticket.subject,
      createdAt: ticket.created_at,
      resolvedAt: ticket.resolved_at,
    },
    messages: messages.map(toPublicMessage),
    canReply: ticket.status !== 'closed',
  });
}

async function handlePostMessage(
  event: SupportApiEvent,
  ref: string
): Promise<ApiResponse> {
  const input = parseOrThrow(postMessageSchema, readJson(event));

  const identity = await readBearerIdentity(event);

  const ticket = await withClient(async (client) => {
    const found = await queries.getTicketByRef(client, ref);
    if (!found) return null;

    return (await authoriseThread(event, client, found, identity)) ? found : null;
  });

  if (!ticket) throw notFound();

  if (ticket.status === 'closed') {
    throw new HttpError(
      409,
      'TICKET_CLOSED',
      'This request is closed. Send a new one and we will pick it up.'
    );
  }

  if (input.requestId) {
    const existing = await withClient((client) =>
      queries.findMessageByRequestId(client, ticket.id, input.requestId as string)
    );
    if (existing) return json(200, toPublicMessage(existing));
  }

  await enforceMessageLimit(ticket.id);

  const message = await withClient(async (client) => {
    try {
      const inserted = await queries.insertMessage(client, {
        ticketId: ticket.id,
        authorType: 'customer',
        authorUserId: ticket.user_id,
        body: input.body,
        requestId: input.requestId ?? null,
      });
      await queries.touchTicket(client, ticket.id, true);
      return inserted;
    } catch (caught) {
      const error = caught as { code?: string; constraint?: string };
      if (error.code === '23505' && error.constraint === 'idx_support_message_idempotency') {
        const existing = input.requestId
          ? await queries.findMessageByRequestId(client, ticket.id, input.requestId)
          : null;
        if (existing) return existing;
      }
      throw caught;
    }
  });

  return json(201, toPublicMessage(message));
}

async function handleListMine(event: SupportApiEvent): Promise<ApiResponse> {
  const sub = authorizerSub(event);
  if (!sub) throw new HttpError(401, 'UNAUTHORIZED', 'Sign in to see your requests.');

  const items = await withClient(async (client) => {
    const userId = await getUserIdByCognitoSub(sub);
    if (!userId) return [];
    return queries.listTicketsForUser(client, userId);
  });

  return json(200, {
    items: items.map((row) => ({
      ref: row.ref,
      subject: row.subject,
      topic: row.topic,
      status: row.status,
      lastMessageAt: row.last_message_at,
      createdAt: row.created_at,
    })),
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function assertSupportEnabled(): Promise<void> {
  await warmSettings(['support_enabled']);

  if (getSettingSync('support_enabled') === false) {
    throw new HttpError(
      503,
      'SUPPORT_DISABLED',
      'Support is temporarily paused. Please try again shortly.'
    );
  }
}

/**
 * A ticket is readable by its token holder, or by a signed-in owner. Anything
 * else is a 404 — a 403 would confirm that the reference exists.
 */
async function authoriseThread(
  event: SupportApiEvent,
  client: Client,
  ticket: queries.TicketRow,
  identity: { sub: string } | null
): Promise<boolean> {
  const token = event.queryStringParameters?.t ?? null;

  // Any unexpired link works — that is the point of issuing one per email.
  if (token) return hasValidThreadToken(client, ticket.id, token);

  if (!identity || !ticket.user_id) return false;

  const userId = await getUserIdByCognitoSub(identity.sub);
  return Boolean(userId && userId === ticket.user_id);
}

function toPublicMessage(message: queries.MessageRow) {
  return {
    id: message.id,
    author: message.author_type,
    body: message.body,
    createdAt: message.created_at,
  };
}

function notFound(): HttpError {
  return new HttpError(
    404,
    'NOT_FOUND',
    'No request matches that link. It may have expired.'
  );
}

function readJson(event: SupportApiEvent): unknown {
  if (!event.body) {
    throw new HttpError(400, 'INVALID_JSON', 'A request body is required.');
  }

  try {
    return JSON.parse(event.body);
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'The request body must be valid JSON.');
  }
}

function parseOrThrow<T extends z.ZodTypeAny>(schema: T, payload: unknown): z.infer<T> {
  const result = schema.safeParse(payload);

  if (!result.success) {
    const fields = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || 'body',
      message: issue.message,
    }));

    throw new HttpError(422, 'VALIDATION_ERROR', fields[0]?.message ?? 'Invalid request.', {
      fields,
    });
  }

  return result.data;
}
