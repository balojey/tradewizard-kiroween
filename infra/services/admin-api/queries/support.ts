/**
 * Support ticket queries for the management portal.
 *
 * Reads are plain and bounded; mutations that involve a customer-visible message
 * take a row lock in the route (see routes/support.ts) so two operators cannot
 * interleave replies on the same ticket.
 */

import type { Client } from 'pg';
import { encodeCursor, type Cursor } from '../lib/pagination';

export interface SupportTicketListRow {
  id: string;
  ref: string;
  subject: string;
  status: 'open' | 'pending' | 'resolved' | 'closed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  topic: string;
  requesterEmail: string;
  assignedAdminSub: string | null;
  createdAt: string;
  lastMessageAt: string;
  firstResponseAt: string | null;
  overdue: boolean;
  marketId: string | null;
}

export interface SupportTicketDetailRow extends SupportTicketListRow {
  body: string;
  context: Record<string, unknown>;
  userId: string | null;
  assignedAt: string | null;
  confirmationSent: boolean;
  lastCustomerNotifiedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
}

export interface SupportMessageRow {
  id: string;
  authorType: 'customer' | 'admin' | 'system';
  authorAdminEmail: string | null;
  body: string;
  isInternal: boolean;
  createdAt: string;
}

export interface SupportListFilters {
  status?: string;
  topic?: string;
  assigneeSub?: string;
  unassignedOnly?: boolean;
  q?: string;
}

const LIST_COLUMNS = `
  id, ref, subject, status, priority, topic,
  requester_email AS "requesterEmail",
  assigned_admin_sub AS "assignedAdminSub",
  last_message_at AS "lastMessageAt",
  first_response_at AS "firstResponseAt",
  created_at AS "createdAt"
`;

export async function listTickets(
  client: Client,
  filters: SupportListFilters,
  pagination: { limit: number; cursor: Cursor | null },
  slaHours: number
): Promise<{ items: SupportTicketListRow[]; nextCursor: string | null }> {
  const params: unknown[] = [];
  const where: string[] = [];

  if (filters.status) {
    params.push(filters.status);
    where.push(`status = $${params.length}`);
  }

  if (filters.topic) {
    params.push(filters.topic);
    where.push(`topic = $${params.length}`);
  }

  if (filters.unassignedOnly) {
    where.push('assigned_admin_sub IS NULL');
  } else if (filters.assigneeSub) {
    params.push(filters.assigneeSub);
    where.push(`assigned_admin_sub = $${params.length}`);
  }

  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(
      `(ref ILIKE $${params.length} OR subject ILIKE $${params.length} OR requester_email ILIKE $${params.length})`
    );
  }

  if (pagination.cursor) {
    params.push(pagination.cursor.createdAt);
    params.push(pagination.cursor.id);
    where.push(`(last_message_at, id) < ($${params.length - 1}::timestamptz, $${params.length})`);
  }

  // SLA hours feed the overdue flag; the limit is always the final parameter.
  params.push(String(slaHours));
  const slaParam = params.length;
  params.push(pagination.limit + 1);
  const limitParam = params.length;

  const result = await client.query(
    `
    SELECT ${LIST_COLUMNS},
           (first_response_at IS NULL
             AND status IN ('open', 'pending')
             AND created_at < now() - ($${slaParam} || ' hours')::interval) AS overdue,
           context->>'marketId' AS "marketId"
      FROM support_tickets
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY last_message_at DESC, id DESC
      LIMIT $${limitParam}
    `,
    params
  );

  const rows = result.rows as Array<SupportTicketListRow & { overdue: boolean }>;
  const hasMore = rows.length > pagination.limit;
  const items = (hasMore ? rows.slice(0, pagination.limit) : rows).map((row) => ({
    ...row,
    overdue: Boolean(row.overdue),
  }));
  const last = items[items.length - 1];

  return {
    items,
    nextCursor:
      hasMore && last ? encodeCursor(String(last.lastMessageAt), last.id) : null,
  };
}

export async function getTicketById(
  client: Client,
  id: string
): Promise<SupportTicketDetailRow | null> {
  const result = await client.query(
    `
    SELECT ${LIST_COLUMNS},
           body, context, user_id AS "userId", assigned_at AS "assignedAt",
           confirmation_sent AS "confirmationSent",
           last_customer_notified_at AS "lastCustomerNotifiedAt",
           resolved_at AS "resolvedAt", closed_at AS "closedAt", false AS overdue
      FROM support_tickets
     WHERE id = $1
    `,
    [id]
  );

  return (result.rows[0] as SupportTicketDetailRow | undefined) ?? null;
}

/** Row lock for mutations that must not interleave with another operator. */
export async function lockTicket(
  client: Client,
  id: string
): Promise<SupportTicketDetailRow | null> {
  const result = await client.query(
    `
    SELECT ${LIST_COLUMNS},
           body, context, user_id AS "userId", assigned_at AS "assignedAt",
           confirmation_sent AS "confirmationSent",
           last_customer_notified_at AS "lastCustomerNotifiedAt",
           resolved_at AS "resolvedAt", closed_at AS "closedAt", false AS overdue
      FROM support_tickets
     WHERE id = $1
       FOR UPDATE
    `,
    [id]
  );

  return (result.rows[0] as SupportTicketDetailRow | undefined) ?? null;
}

export async function listMessages(
  client: Client,
  ticketId: string
): Promise<SupportMessageRow[]> {
  const result = await client.query(
    `
    SELECT id,
           author_type AS "authorType",
           author_admin_email AS "authorAdminEmail",
           body,
           is_internal AS "isInternal",
           created_at AS "createdAt"
      FROM support_messages
     WHERE ticket_id = $1
     ORDER BY created_at ASC
    `,
    [ticketId]
  );

  return result.rows as SupportMessageRow[];
}

export async function claimTicket(
  client: Client,
  id: string,
  adminSub: string
): Promise<boolean> {
  const result = await client.query(
    `
    UPDATE support_tickets
       SET assigned_admin_sub = $2, assigned_at = now(), updated_at = now()
     WHERE id = $1
       AND (assigned_admin_sub IS NULL OR assigned_admin_sub = $2)
    RETURNING id
    `,
    [id, adminSub]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function releaseTicket(
  client: Client,
  id: string,
  adminSub: string,
  force: boolean
): Promise<boolean> {
  const result = await client.query(
    `
    UPDATE support_tickets
       SET assigned_admin_sub = NULL, assigned_at = NULL, updated_at = now()
     WHERE id = $1
       AND ($3 OR assigned_admin_sub = $2)
    RETURNING id
    `,
    [id, adminSub, force]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function assignTicket(
  client: Client,
  id: string,
  adminSub: string | null
): Promise<void> {
  await client.query(
    `
    UPDATE support_tickets
       SET assigned_admin_sub = $2,
           assigned_at = CASE WHEN $2 IS NULL THEN NULL ELSE now() END,
           updated_at = now()
     WHERE id = $1
    `,
    [id, adminSub]
  );
}

export async function insertAdminMessage(
  client: Client,
  input: {
    ticketId: string;
    adminSub: string;
    adminEmail: string;
    body: string;
    internal: boolean;
    requestId: string | null;
  }
): Promise<SupportMessageRow> {
  const result = await client.query(
    `
    INSERT INTO support_messages
      (ticket_id, author_type, author_admin_sub, author_admin_email, body, is_internal, request_id)
    VALUES ($1, 'admin', $2, $3, $4, $5, $6)
    RETURNING id,
              author_type AS "authorType",
              author_admin_email AS "authorAdminEmail",
              body,
              is_internal AS "isInternal",
              created_at AS "createdAt"
    `,
    [
      input.ticketId,
      input.adminSub,
      input.adminEmail,
      input.body,
      input.internal,
      input.requestId,
    ]
  );

  return result.rows[0] as SupportMessageRow;
}

/**
 * Public replies move the ticket to `pending` (waiting on the customer) and set
 * the first-response timestamp once. Internal notes only bump activity.
 */
export async function recordReply(
  client: Client,
  input: { ticketId: string; internal: boolean; emailed: boolean }
): Promise<void> {
  await client.query(
    `
    UPDATE support_tickets
       SET last_message_at = now(),
           updated_at = now(),
           status = CASE
             WHEN $2 AND status IN ('open', 'resolved') THEN 'pending'
             ELSE status
           END,
           resolved_at = CASE WHEN $2 AND status = 'resolved' THEN NULL ELSE resolved_at END,
           first_response_at = CASE
             WHEN $2 AND first_response_at IS NULL THEN now()
             ELSE first_response_at
           END,
           last_customer_notified_at = CASE WHEN $3 THEN now() ELSE last_customer_notified_at END
     WHERE id = $1
    `,
    [input.ticketId, !input.internal, input.emailed]
  );
}

export async function updateTicket(
  client: Client,
  id: string,
  fields: {
    status?: string;
    priority?: string;
  }
): Promise<void> {
  await client.query(
    `
    UPDATE support_tickets
       SET status = COALESCE($2, status),
           priority = COALESCE($3, priority),
           updated_at = now(),
           resolved_at = CASE
             WHEN $2 = 'resolved' THEN now()
             WHEN $2 IN ('open', 'pending') THEN NULL
             ELSE resolved_at
           END,
           closed_at = CASE
             WHEN $2 = 'closed' THEN now()
             WHEN $2 IN ('open', 'pending', 'resolved') THEN NULL
             ELSE closed_at
           END
     WHERE id = $1
    `,
    [id, fields.status ?? null, fields.priority ?? null]
  );
}

export async function requesterInfo(
  client: Client,
  userId: string | null,
  email: string
): Promise<{
  userId: string | null;
  status: string | null;
  plan: string | null;
  createdAt: string | null;
}> {
  const result = await client.query(
    `
    SELECT u.id AS "userId", u.status, s.plan, u.created_at AS "createdAt"
      FROM users u
      LEFT JOIN LATERAL (
        SELECT plan FROM subscriptions
         WHERE user_id = u.id
         ORDER BY created_at DESC
         LIMIT 1
      ) s ON true
     WHERE ($1::uuid IS NOT NULL AND u.id = $1::uuid)
        OR u.email = $2
     LIMIT 1
    `,
    [userId, email]
  );

  return (
    (result.rows[0] as {
      userId: string;
      status: string;
      plan: string | null;
      createdAt: string;
    } | undefined) ?? { userId: null, status: null, plan: null, createdAt: null }
  );
}

export async function summaryCounts(
  client: Client,
  slaHours: number
): Promise<{ open: number; pending: number; unassigned: number; overdue: number }> {
  const result = await client.query(
    `
    SELECT
      count(*) FILTER (WHERE status = 'open') AS open,
      count(*) FILTER (WHERE status = 'pending') AS pending,
      count(*) FILTER (WHERE status IN ('open', 'pending') AND assigned_admin_sub IS NULL) AS unassigned,
      count(*) FILTER (
        WHERE first_response_at IS NULL
          AND status IN ('open', 'pending')
          AND created_at < now() - ($1 || ' hours')::interval
      ) AS overdue
      FROM support_tickets
    `,
    [String(slaHours)]
  );

  const row = result.rows[0] as Record<string, string>;
  return {
    open: Number(row.open ?? 0),
    pending: Number(row.pending ?? 0),
    unassigned: Number(row.unassigned ?? 0),
    overdue: Number(row.overdue ?? 0),
  };
}

export async function findMessageByRequestId(
  client: Client,
  ticketId: string,
  requestId: string
): Promise<SupportMessageRow | null> {
  const result = await client.query(
    `
    SELECT id, author_type AS "authorType", author_admin_email AS "authorAdminEmail",
           body, is_internal AS "isInternal", created_at AS "createdAt"
      FROM support_messages
     WHERE ticket_id = $1 AND request_id = $2
     LIMIT 1
    `,
    [ticketId, requestId]
  );

  return (result.rows[0] as SupportMessageRow | undefined) ?? null;
}
