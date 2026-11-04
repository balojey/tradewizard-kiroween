/**
 * Newsletter campaign queries.
 *
 * Sending is driven by the `newsletter-send` Lambda; this module owns the portal
 * side: drafts, audience size, snapshotting recipients, and the claim that makes
 * a send idempotent.
 */

import type { Client } from 'pg';
import { encodeCursor, type Cursor } from '../lib/pagination';

export interface CampaignRow {
  id: string;
  slug: string | null;
  subject: string;
  preheader: string | null;
  template: string;
  content: Record<string, unknown>;
  audience: Record<string, unknown>;
  status: 'draft' | 'sending' | 'sent' | 'failed' | 'cancelled';
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  createdBy: string;
  approvedBy: string | null;
  createdAt: string;
  startedAt: string | null;
  sentAt: string | null;
}

const CAMPAIGN_COLUMNS = `
  id, slug, subject, preheader, template, content, audience, status,
  recipient_count AS "recipientCount",
  sent_count AS "sentCount",
  failed_count AS "failedCount",
  created_by AS "createdBy",
  approved_by AS "approvedBy",
  created_at AS "createdAt",
  started_at AS "startedAt",
  sent_at AS "sentAt"
`;

export async function listCampaigns(
  client: Client,
  filters: { status?: string },
  pagination: { limit: number; cursor: Cursor | null }
): Promise<{ items: CampaignRow[]; nextCursor: string | null }> {
  const params: unknown[] = [];
  const where: string[] = [];

  if (filters.status) {
    params.push(filters.status);
    where.push(`status = $${params.length}`);
  }

  if (pagination.cursor) {
    params.push(pagination.cursor.createdAt, pagination.cursor.id);
    where.push(`(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length})`);
  }

  params.push(pagination.limit + 1);

  const result = await client.query(
    `SELECT ${CAMPAIGN_COLUMNS}
       FROM newsletter_campaigns
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}`,
    params
  );

  const rows = result.rows as CampaignRow[];
  const hasMore = rows.length > pagination.limit;
  const items = hasMore ? rows.slice(0, pagination.limit) : rows;
  const last = items[items.length - 1];

  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export async function getCampaign(client: Client, id: string): Promise<CampaignRow | null> {
  const result = await client.query(
    `SELECT ${CAMPAIGN_COLUMNS} FROM newsletter_campaigns WHERE id = $1 LIMIT 1`,
    [id]
  );
  return (result.rows[0] as CampaignRow | undefined) ?? null;
}

export async function createCampaign(
  client: Client,
  input: {
    slug: string;
    subject: string;
    preheader: string | null;
    template: string;
    content: Record<string, unknown>;
    createdBy: string;
  }
): Promise<CampaignRow> {
  const result = await client.query(
    `INSERT INTO newsletter_campaigns (slug, subject, preheader, template, content, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING ${CAMPAIGN_COLUMNS}`,
    [
      input.slug,
      input.subject,
      input.preheader,
      input.template,
      JSON.stringify(input.content),
      input.createdBy,
    ]
  );

  return result.rows[0] as CampaignRow;
}

export async function updateCampaign(
  client: Client,
  id: string,
  input: {
    subject: string;
    preheader: string | null;
    template: string;
    content: Record<string, unknown>;
  }
): Promise<CampaignRow | null> {
  const result = await client.query(
    `UPDATE newsletter_campaigns
        SET subject = $2,
            preheader = $3,
            template = $4,
            content = $5::jsonb,
            updated_at = now()
      WHERE id = $1 AND status = 'draft'
      RETURNING ${CAMPAIGN_COLUMNS}`,
    [
      id,
      input.subject,
      input.preheader,
      input.template,
      JSON.stringify(input.content),
    ]
  );

  return (result.rows[0] as CampaignRow | undefined) ?? null;
}

/** Confirmed subscribers who are not suppressed. */
export async function countAudience(client: Client): Promise<number> {
  const result = await client.query(
    `SELECT count(*) AS count
       FROM newsletter_subscribers s
       LEFT JOIN newsletter_suppressions x ON x.email = s.email
      WHERE s.status = 'subscribed' AND x.email IS NULL`
  );

  return Number((result.rows[0] as { count: string }).count);
}

/**
 * Claim a draft for sending. Returning null means it was already claimed or is
 * not a draft — which is exactly what a retried invoke must see.
 */
export async function claimCampaign(
  client: Client,
  id: string,
  approvedBy: string
): Promise<CampaignRow | null> {
  const result = await client.query(
    `UPDATE newsletter_campaigns
        SET status = 'sending',
            approved_by = $2,
            started_at = now(),
            updated_at = now()
      WHERE id = $1 AND status = 'draft'
      RETURNING ${CAMPAIGN_COLUMNS}`,
    [id, approvedBy]
  );

  return (result.rows[0] as CampaignRow | undefined) ?? null;
}

/**
 * Snapshot the audience. `unique (campaign_id, email)` makes a repeated call
 * harmless, and unsubscribing later flips remaining queued rows to `skipped`.
 */
export async function snapshotRecipients(client: Client, campaignId: string): Promise<number> {
  await client.query(
    `INSERT INTO newsletter_deliveries (campaign_id, email, user_id, status)
     SELECT $1, s.email, s.user_id, 'queued'
       FROM newsletter_subscribers s
       LEFT JOIN newsletter_suppressions x ON x.email = s.email
      WHERE s.status = 'subscribed' AND x.email IS NULL
     ON CONFLICT (campaign_id, email) DO NOTHING`,
    [campaignId]
  );

  const result = await client.query(
    `UPDATE newsletter_campaigns
        SET recipient_count = (
          SELECT count(*) FROM newsletter_deliveries WHERE campaign_id = $1
        ),
        updated_at = now()
      WHERE id = $1
      RETURNING recipient_count AS "recipientCount"`,
    [campaignId]
  );

  return Number((result.rows[0] as { recipientCount: string }).recipientCount);
}

export async function cancelCampaign(
  client: Client,
  id: string
): Promise<CampaignRow | null> {
  const result = await client.query(
    `UPDATE newsletter_campaigns
        SET status = 'cancelled', cancelled_at = now(), updated_at = now()
      WHERE id = $1 AND status IN ('draft', 'sending')
      RETURNING ${CAMPAIGN_COLUMNS}`,
    [id]
  );

  await client.query(
    `UPDATE newsletter_deliveries
        SET status = 'skipped'
      WHERE campaign_id = $1 AND status = 'queued'`,
    [id]
  );

  return (result.rows[0] as CampaignRow | undefined) ?? null;
}

export async function campaignSummary(
  client: Client
): Promise<{
  drafts: number;
  sending: number;
  sent: number;
  subscribers: number;
  unsubscribed: number;
  suppressed: number;
}> {
  const result = await client.query(
    `SELECT
       count(*) FILTER (WHERE status = 'draft') AS drafts,
       count(*) FILTER (WHERE status = 'sending') AS sending,
       count(*) FILTER (WHERE status = 'sent') AS sent
     FROM newsletter_campaigns`
  );

  const audience = await countAudience(client);
  const row = result.rows[0] as Record<string, string>;

  const extras = await client.query(
    `SELECT
       (SELECT count(*) FROM newsletter_subscribers WHERE status = 'unsubscribed') AS unsubscribed,
       (SELECT count(*) FROM newsletter_suppressions) AS suppressed`
  );
  const extraRow = extras.rows[0] as Record<string, string>;

  return {
    drafts: Number(row.drafts ?? 0),
    sending: Number(row.sending ?? 0),
    sent: Number(row.sent ?? 0),
    subscribers: audience,
    unsubscribed: Number(extraRow.unsubscribed ?? 0),
    suppressed: Number(extraRow.suppressed ?? 0),
  };
}

export async function deliveryBreakdown(
  client: Client,
  campaignId: string
): Promise<Record<string, number>> {
  const result = await client.query(
    `SELECT status, count(*) AS count
       FROM newsletter_deliveries
      WHERE campaign_id = $1
      GROUP BY status`,
    [campaignId]
  );

  return Object.fromEntries(
    (result.rows as Array<{ status: string; count: string }>).map((row) => [
      row.status,
      Number(row.count),
    ])
  );
}

export interface SubscriberRow {
  email: string;
  status: 'subscribed' | 'unsubscribed';
  source: string;
  userId: string | null;
  confirmedAt: string | null;
  unsubscribedAt: string | null;
  suppressedReason: string | null;
  createdAt: string;
}

export async function listSubscribers(
  client: Client,
  filters: { status?: string; q?: string },
  pagination: { limit: number; cursor: Cursor | null }
): Promise<{ items: SubscriberRow[]; nextCursor: string | null }> {
  const params: unknown[] = [];
  const where: string[] = [];

  if (filters.status) {
    params.push(filters.status);
    where.push(`s.status = $${params.length}`);
  }

  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(`s.email ILIKE $${params.length}`);
  }

  if (pagination.cursor) {
    params.push(pagination.cursor.createdAt, pagination.cursor.id);
    where.push(`(s.created_at, s.email) < ($${params.length - 1}::timestamptz, $${params.length})`);
  }

  params.push(pagination.limit + 1);

  const result = await client.query(
    `SELECT s.email, s.status, s.source, s.user_id AS "userId",
            s.confirmed_at AS "confirmedAt", s.unsubscribed_at AS "unsubscribedAt",
            x.reason AS "suppressedReason", s.created_at AS "createdAt"
       FROM newsletter_subscribers s
       LEFT JOIN newsletter_suppressions x ON x.email = s.email
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY s.created_at DESC, s.email DESC
      LIMIT $${params.length}`,
    params
  );

  const rows = result.rows as SubscriberRow[];
  const hasMore = rows.length > pagination.limit;
  const items = hasMore ? rows.slice(0, pagination.limit) : rows;
  const last = items[items.length - 1];

  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.email) : null,
  };
}
