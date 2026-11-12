/**
 * Support ticket retrieval.
 *
 * A ticket is the one place where operator-facing text is written by a
 * customer, so it is the highest-risk prompt-injection surface in the portal.
 * Bodies are sanitised (links stripped, token-shaped strings removed) and the
 * thread is capped at 30 messages.
 *
 * See docs/plans/warden-ai-copilot.md §5 and §6.
 */

import type { Client } from 'pg';
import type { AdminRole } from '../../shared/admin-auth';
import { canReadCustomerIdentity } from './scope';
import { sanitizeUntrustedText, safeStringify, truncate } from './redact';
import type { RetrievedRecord } from '../types';

export const MESSAGE_LIMIT = 30;

export interface SupportTicketRow {
  id: string;
  ref: string;
  requesterEmail: string;
  userId: string | null;
  topic: string;
  status: string;
  priority: string;
  subject: string;
  body: string;
  context: unknown;
  createdAt: Date | string;
  lastMessageAt: Date | string;
  firstResponseAt: Date | string | null;
  assignedAdminSub: string | null;
}

export interface SupportMessageRow {
  authorType: string;
  authorAdminEmail: string | null;
  body: string;
  isInternal: boolean;
  createdAt: Date | string;
}

export interface SupportRetrieval {
  ticket: SupportTicketRow | null;
  records: RetrievedRecord[];
  /** Analysis id carried by the ticket snapshot, when present. */
  analysisId: string | null;
  userId: string | null;
}

export async function retrieveSupport(
  client: Client,
  options: { role: AdminRole; ticketId: string }
): Promise<SupportRetrieval> {
  const ticketResult = await client.query<SupportTicketRow>(
    `
    SELECT
      id, ref, requester_email AS "requesterEmail", user_id AS "userId",
      topic, status, priority, subject, body, context,
      created_at AS "createdAt", last_message_at AS "lastMessageAt",
      first_response_at AS "firstResponseAt",
      assigned_admin_sub AS "assignedAdminSub"
    FROM support_tickets
    WHERE id = $1::uuid
    LIMIT 1
    `,
    [options.ticketId]
  );

  const ticket = ticketResult.rows[0];
  if (!ticket) {
    return { ticket: null, records: [], analysisId: null, userId: null };
  }

  const messagesResult = await client.query<SupportMessageRow>(
    `
    SELECT
      author_type AS "authorType",
      author_admin_email AS "authorAdminEmail",
      body,
      is_internal AS "isInternal",
      created_at AS "createdAt"
    FROM support_messages
    WHERE ticket_id = $1::uuid
    ORDER BY created_at ASC
    LIMIT $2
    `,
    [options.ticketId, MESSAGE_LIMIT]
  );

  const requester = ticket.userId
    ? await loadRequesterContext(client, ticket.userId)
    : null;

  const identityVisible = canReadCustomerIdentity(options.role);
  const context = normalizeContext(ticket.context);
  const analysisId = context.analysisId ?? context.resultId ?? null;

  const messages = messagesResult.rows.map((message) => ({
    author: message.authorType,
    adminEmail: identityVisible ? message.authorAdminEmail : null,
    internal: message.isInternal,
    at: iso(message.createdAt),
    body: sanitizeUntrustedText(message.body, options.role, 900),
  }));

  return {
    ticket,
    userId: ticket.userId,
    analysisId,
    records: [
      {
        type: 'ticket',
        id: ticket.id,
        label: `${ticket.ref} · ${ticket.subject}`,
        url: `/support/${encodeURIComponent(ticket.id)}`,
        at: iso(ticket.createdAt),
        data: {
          ref: ticket.ref,
          subject: sanitizeUntrustedText(ticket.subject, options.role, 200),
          status: ticket.status,
          priority: ticket.priority,
          topic: ticket.topic,
          requesterEmail: identityVisible
            ? sanitizeUntrustedText(ticket.requesterEmail, options.role, 200)
            : '[redacted]',
          createdAt: iso(ticket.createdAt),
          lastMessageAt: iso(ticket.lastMessageAt),
          firstResponseAt: iso(ticket.firstResponseAt),
          assigned: Boolean(ticket.assignedAdminSub),
          requester: requester
            ? {
                plan: requester.plan,
                status: requester.status,
                memberSince: requester.memberSince,
              }
            : null,
          snapshot: sanitizeUntrustedText(safeStringify(context, 900), options.role, 900),
          body: sanitizeUntrustedText(ticket.body, options.role, 1_200),
          messages,
        },
      },
    ],
  };
}

async function loadRequesterContext(
  client: Client,
  userId: string
): Promise<{ plan: string | null; status: string | null; memberSince: string | null } | null> {
  const result = await client.query<{
    plan: string | null;
    status: string | null;
    createdAt: Date | string | null;
  }>(
    `
    SELECT s.plan, u.status, u.created_at AS "createdAt"
    FROM users u
    LEFT JOIN subscriptions s ON s.user_id = u.id
    WHERE u.id = $1::uuid
    LIMIT 1
    `,
    [userId]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    plan: row.plan,
    status: row.status,
    memberSince: iso(row.createdAt),
  };
}

function normalizeContext(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const entries = Object.entries(raw as Record<string, unknown>)
    .filter(([, value]) => typeof value === 'string' && value.length > 0)
    .slice(0, 12);

  return Object.fromEntries(entries.map(([key, value]) => [key, truncate(String(value), 200)]));
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}
