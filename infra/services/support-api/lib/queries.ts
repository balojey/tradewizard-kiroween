/**
 * Database access for support tickets.
 *
 * Hand-written SQL with explicit column lists: `SELECT *` would leak the token
 * hash into anything that serialises a row.
 */

import type { Client } from 'pg';
import { generateRef } from './tokens';
import { issueThreadToken } from '../../shared/support-tickets';

export interface TicketRow {
  id: string;
  ref: string;
  requester_email: string;
  user_id: string | null;
  topic: string;
  status: string;
  priority: string;
  subject: string;
  body: string;
  context: Record<string, unknown>;
  context_hash: string | null;
  assigned_admin_sub: string | null;
  confirmation_sent: boolean;
  last_message_at: Date;
  resolved_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
}

export interface MessageRow {
  id: string;
  author_type: 'customer' | 'admin' | 'system';
  author_user_id: string | null;
  author_admin_sub: string | null;
  author_admin_email: string | null;
  body: string;
  is_internal: boolean;
  created_at: Date;
}

const TICKET_COLUMNS = `
  id, ref, requester_email, user_id, topic, status, priority, subject, body,
  context, context_hash, assigned_admin_sub, confirmation_sent,
  last_message_at, resolved_at, closed_at, created_at
`;

export interface NewTicket {
  email: string;
  userId: string | null;
  topic: string;
  subject: string;
  body: string;
  context: Record<string, string>;
  contextHash: string;
  appVersion: string | null;
  requestId: string | null;
  ipHash: string;
}

export interface CreatedTicket {
  id: string;
  ref: string;
  accessToken: string;
}

/**
 * Insert a ticket plus its first message.
 *
 * Returns `null` when the idempotency key already exists — the caller re-reads
 * the original ticket and replies with the same ref instead of a new one.
 * Reference collisions retry with a fresh ref (the space is ~1e9).
 */
export async function insertTicket(
  client: Client,
  ticket: NewTicket
): Promise<CreatedTicket | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ref = generateRef();

    try {
      const inserted = await client.query(
        `INSERT INTO support_tickets (
           ref, requester_email, user_id, topic, subject, body, context, context_hash,
           app_version, request_id, ip_hash
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
         RETURNING id, ref`,
        [
          ref,
          ticket.email,
          ticket.userId,
          ticket.topic,
          ticket.subject,
          ticket.body,
          JSON.stringify(ticket.context),
          ticket.contextHash,
          ticket.appVersion,
          ticket.requestId,
          ticket.ipHash,
        ]
      );

      const row = inserted.rows[0] as { id: string; ref: string };

      await insertMessage(client, {
        ticketId: row.id,
        authorType: 'customer',
        authorUserId: ticket.userId,
        body: ticket.body,
      });

      // Additive: each acknowledgement issues its own working link.
      const accessToken = await issueThreadToken(client, row.id);

      return { id: row.id, ref: row.ref, accessToken };
    } catch (caught) {
      const error = caught as { code?: string; constraint?: string };

      if (error.code === '23505' && error.constraint === 'idx_support_request_idempotency') {
        return null;
      }

      // Any other unique violation is the ref; try again with a new one.
      if (error.code === '23505') continue;
      throw caught;
    }
  }

  throw new Error('Could not allocate a unique support ticket reference');
}

export async function findTicketByRequestId(
  client: Client,
  email: string,
  requestId: string
): Promise<TicketRow | null> {
  const result = await client.query(
    `SELECT ${TICKET_COLUMNS} FROM support_tickets
      WHERE requester_email = $1 AND request_id = $2
      LIMIT 1`,
    [email, requestId]
  );
  return (result.rows[0] as TicketRow | undefined) ?? null;
}

/**
 * Same requester, same context, still open, inside the dedupe window.
 */
export async function findRecentDuplicate(
  client: Client,
  email: string,
  contextHash: string,
  windowMinutes = 10
): Promise<TicketRow | null> {
  const result = await client.query(
    `SELECT ${TICKET_COLUMNS} FROM support_tickets
      WHERE requester_email = $1
        AND context_hash = $2
        AND status IN ('open', 'pending')
        AND created_at > now() - ($3 || ' minutes')::interval
      ORDER BY created_at DESC
      LIMIT 1`,
    [email, contextHash, String(windowMinutes)]
  );
  return (result.rows[0] as TicketRow | undefined) ?? null;
}

export async function getTicketByRef(client: Client, ref: string): Promise<TicketRow | null> {
  const result = await client.query(
    `SELECT ${TICKET_COLUMNS} FROM support_tickets WHERE ref = $1 LIMIT 1`,
    [ref]
  );
  return (result.rows[0] as TicketRow | undefined) ?? null;
}

export async function getTicketById(client: Client, id: string): Promise<TicketRow | null> {
  const result = await client.query(
    `SELECT ${TICKET_COLUMNS} FROM support_tickets WHERE id = $1 LIMIT 1`,
    [id]
  );
  return (result.rows[0] as TicketRow | undefined) ?? null;
}

export async function listMessages(
  client: Client,
  ticketId: string,
  includeInternal = false
): Promise<MessageRow[]> {
  const result = await client.query(
    `SELECT id, author_type, author_user_id, author_admin_sub, author_admin_email,
            body, is_internal, created_at
       FROM support_messages
      WHERE ticket_id = $1 ${includeInternal ? '' : 'AND is_internal = false'}
      ORDER BY created_at ASC`,
    [ticketId]
  );
  return result.rows as MessageRow[];
}

export async function insertMessage(
  client: Client,
  message: {
    ticketId: string;
    authorType: 'customer' | 'admin' | 'system';
    authorUserId?: string | null;
    authorAdminSub?: string | null;
    authorAdminEmail?: string | null;
    body: string;
    isInternal?: boolean;
    requestId?: string | null;
  }
): Promise<MessageRow> {
  const result = await client.query(
    `INSERT INTO support_messages
       (ticket_id, author_type, author_user_id, author_admin_sub, author_admin_email, body, is_internal, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, author_type, author_user_id, author_admin_sub, author_admin_email,
               body, is_internal, created_at`,
    [
      message.ticketId,
      message.authorType,
      message.authorUserId ?? null,
      message.authorAdminSub ?? null,
      message.authorAdminEmail ?? null,
      message.body,
      message.isInternal ?? false,
      message.requestId ?? null,
    ]
  );
  return result.rows[0] as MessageRow;
}

export async function findMessageByRequestId(
  client: Client,
  ticketId: string,
  requestId: string
): Promise<MessageRow | null> {
  const result = await client.query(
    `SELECT id, author_type, author_user_id, author_admin_sub, author_admin_email,
            body, is_internal, created_at
       FROM support_messages
      WHERE ticket_id = $1 AND request_id = $2
      LIMIT 1`,
    [ticketId, requestId]
  );
  return (result.rows[0] as MessageRow | undefined) ?? null;
}

/**
 * Bump activity, and reopen a ticket the team was waiting on.
 *
 * Reopening clears `resolved_at` so the customer's reply does not look like it
 * arrived after the ticket was solved.
 */
export async function touchTicket(
  client: Client,
  ticketId: string,
  reopen: boolean
): Promise<void> {
  await client.query(
    `UPDATE support_tickets
        SET last_message_at = now(),
            updated_at = now(),
            status = CASE WHEN $2 AND status IN ('pending', 'resolved') THEN 'open' ELSE status END,
            resolved_at = CASE WHEN $2 AND status IN ('pending', 'resolved') THEN NULL ELSE resolved_at END
      WHERE id = $1`,
    [ticketId, reopen]
  );
}

export async function markConfirmationSent(client: Client, ticketId: string): Promise<void> {
  await client.query(
    `UPDATE support_tickets
        SET confirmation_sent = true, last_customer_notified_at = now(), updated_at = now()
      WHERE id = $1`,
    [ticketId]
  );
}

export async function findUserIdByEmail(
  client: Client,
  email: string
): Promise<string | null> {
  const result = await client.query(
    `SELECT id FROM users WHERE lower(email) = $1 LIMIT 1`,
    [email.toLowerCase()]
  );
  return (result.rows[0] as { id: string } | undefined)?.id ?? null;
}

export async function listTicketsForUser(
  client: Client,
  userId: string
): Promise<Array<Pick<TicketRow, 'ref' | 'subject' | 'topic' | 'status' | 'last_message_at' | 'created_at'>>> {
  const result = await client.query(
    `SELECT ref, subject, topic, status, last_message_at, created_at
       FROM support_tickets
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 50`,
    [userId]
  );
  return result.rows;
}
