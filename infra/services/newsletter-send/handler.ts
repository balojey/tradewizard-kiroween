/**
 * Newsletter sender.
 *
 * Invoked asynchronously by the portal after it has claimed the campaign and
 * snapshotted the audience. Its only job is to move queued deliveries to a
 * terminal state, in batches, without sending anything twice.
 *
 * Safety properties:
 * - the portal's claim means one sender per campaign;
 * - `unique (campaign_id, email)` plus status transitions mean a retry cannot
 *   re-send a delivered message;
 * - a systemic failure stops the campaign instead of burning the list.
 */

import { Client } from 'pg';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { getConnectionString } from '../shared/db';
import { contentSchemaFor } from '../shared/newsletter-content';
import { renderNewsletter } from '../shared/newsletter-render';
import { createUnsubscribeToken } from '../shared/newsletter-token';
import { sendEmailBatch, type EmailMessage } from '../shared/email';

const BATCH_SIZE = 50;
const MAX_FAILURE_RATIO = 0.05;
const MIN_FAILURES_BEFORE_STOP = 5;
const CONTINUE_AFTER_MS = 10 * 60 * 1000;

const APP_URL = (process.env.APP_URL || 'https://tradewizard.live').replace(/\/+$/, '');
const FROM = process.env.NEWSLETTER_FROM_EMAIL || 'news@tradewizard.live';

const lambda = new LambdaClient({});

interface SenderEvent {
  campaignId: string;
}

interface QueuedDelivery {
  id: string;
  email: string;
  name: string | null;
}

interface CampaignRow {
  id: string;
  slug: string | null;
  subject: string;
  preheader: string | null;
  template: string;
  content: unknown;
  status: string;
}

export async function handler(event: SenderEvent): Promise<Record<string, unknown>> {
  if (!event?.campaignId) return { skipped: true, reason: 'no campaign id' };

  const client = new Client({
    connectionString: await getConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    await client.query('SET statement_timeout = 15000');

    const campaign = await loadCampaign(client, event.campaignId);
    if (!campaign || campaign.status !== 'sending') {
      return { skipped: true, reason: 'campaign is not sending' };
    }

    // Recover rows left in `sending` by a previous invocation that died mid-batch.
    await client.query(
      `UPDATE newsletter_deliveries
          SET status = 'queued'
        WHERE campaign_id = $1 AND status = 'sending'`,
      [campaign.id]
    );

    const content = contentSchemaFor(campaign.template).parse(campaign.content);
    const startedAt = Date.now();

    let failures = 0;
    let attempted = 0;
    let stopped = false;

    for (;;) {
      const status = await campaignStatus(client, campaign.id);
      if (status === 'cancelled') {
        await skipQueued(client, campaign.id);
        break;
      }

      const batch = await takeBatch(client, campaign.id);
      if (batch.length === 0) break;

      attempted += batch.length;

      const messages = await Promise.all(
        batch.map((row) => buildMessage(campaign, content, row))
      );

      try {
        const result = await sendEmailBatch(messages);

        await Promise.all(
          batch.map((row, index) =>
            markSent(client, row.id, result.messageIds[index] ?? null)
          )
        );
      } catch (error) {
        failures += batch.length;
        const message = error instanceof Error ? error.message : String(error);

        console.error('Newsletter batch failed', {
          campaignId: campaign.id,
          size: batch.length,
          error: message,
        });

        await Promise.all(batch.map((row) => markFailed(client, row.id, message)));
      }

      await refreshCounts(client, campaign.id);

      if (
        failures >= MIN_FAILURES_BEFORE_STOP &&
        attempted > 0 &&
        failures / attempted > MAX_FAILURE_RATIO
      ) {
        stopped = true;
        break;
      }

      if (Date.now() - startedAt > CONTINUE_AFTER_MS) {
        await continueInNewInvocation(campaign.id);
        return { continued: true, attempted, failures };
      }

      // Pace batches under the provider's account-level rate limit.
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    const queued = await countQueued(client, campaign.id);

    if (stopped) {
      await client.query(
        `UPDATE newsletter_campaigns
            SET status = 'failed', updated_at = now()
          WHERE id = $1 AND status = 'sending'`,
        [campaign.id]
      );
    } else if (queued === 0) {
      await client.query(
        `UPDATE newsletter_campaigns
            SET status = 'sent', sent_at = now(), updated_at = now()
          WHERE id = $1 AND status = 'sending'`,
        [campaign.id]
      );
    }

    await refreshCounts(client, campaign.id);

    console.log(
      JSON.stringify({
        metric: 'NewsletterSend',
        campaignId: campaign.id,
        attempted,
        failures,
        queued,
        stopped,
      })
    );

    return { campaignId: campaign.id, attempted, failures, queued, stopped };
  } catch (error) {
    console.error('Newsletter send failed', error);

    await client
      .query(
        `UPDATE newsletter_campaigns
            SET status = 'failed', updated_at = now()
          WHERE id = $1 AND status = 'sending'`,
        [event.campaignId]
      )
      .catch(() => undefined);

    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function loadCampaign(client: Client, id: string): Promise<CampaignRow | null> {
  const result = await client.query(
    `SELECT id, slug, subject, preheader, template, content, status
       FROM newsletter_campaigns
      WHERE id = $1
      LIMIT 1`,
    [id]
  );

  return (result.rows[0] as CampaignRow | undefined) ?? null;
}

async function campaignStatus(client: Client, id: string): Promise<string> {
  const result = await client.query(
    `SELECT status FROM newsletter_campaigns WHERE id = $1`,
    [id]
  );

  return (result.rows[0] as { status: string } | undefined)?.status ?? 'missing';
}

async function takeBatch(client: Client, campaignId: string): Promise<QueuedDelivery[]> {
  const result = await client.query(
    `SELECT d.id, d.email, u.display_name AS name
       FROM newsletter_deliveries d
       LEFT JOIN users u ON u.id = d.user_id
      WHERE d.campaign_id = $1 AND d.status = 'queued'
      ORDER BY d.created_at ASC
      LIMIT $2`,
    [campaignId, BATCH_SIZE]
  );

  const rows = result.rows as QueuedDelivery[];

  if (rows.length > 0) {
    await client.query(
      `UPDATE newsletter_deliveries
          SET status = 'sending', attempts = attempts + 1
        WHERE id = ANY($1::uuid[])`,
      [rows.map((row) => row.id)]
    );
  }

  return rows;
}

async function buildMessage(
  campaign: CampaignRow,
  content: ReturnType<ReturnType<typeof contentSchemaFor>['parse']>,
  row: QueuedDelivery
): Promise<EmailMessage> {
  const token = await createUnsubscribeToken(row.email);
  const unsubscribeUrl = `${APP_URL}/unsubscribe?token=${encodeURIComponent(token)}`;

  const rendered = await renderNewsletter({
    template: campaign.template as 'market_brief' | 'product_update',
    content: content as never,
    subject: campaign.subject,
    preheader: campaign.preheader,
    recipientName: row.name,
    unsubscribeUrl,
    webViewUrl: campaign.slug ? `${APP_URL}/newsletter/${campaign.slug}` : null,
    issueDate: new Date().toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }),
  });

  return {
    to: row.email,
    from: FROM,
    subject: campaign.subject,
    html: rendered.html,
    text: rendered.text,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

async function markSent(client: Client, id: string, messageId: string | null): Promise<void> {
  await client.query(
    `UPDATE newsletter_deliveries
        SET status = 'sent', provider_message_id = $2, sent_at = now(), error = NULL
      WHERE id = $1`,
    [id, messageId]
  );
}

async function markFailed(client: Client, id: string, error: string): Promise<void> {
  await client.query(
    `UPDATE newsletter_deliveries
        SET status = 'failed', error = $2
      WHERE id = $1`,
    [id, error.slice(0, 500)]
  );
}

async function skipQueued(client: Client, campaignId: string): Promise<void> {
  await client.query(
    `UPDATE newsletter_deliveries
        SET status = 'skipped'
      WHERE campaign_id = $1 AND status IN ('queued', 'sending')`,
    [campaignId]
  );
}

async function refreshCounts(client: Client, campaignId: string): Promise<void> {
  await client.query(
    `UPDATE newsletter_campaigns c
        SET sent_count = s.sent,
            failed_count = s.failed,
            updated_at = now()
       FROM (
         SELECT
           count(*) FILTER (WHERE status = 'sent') AS sent,
           count(*) FILTER (WHERE status = 'failed') AS failed
           FROM newsletter_deliveries
          WHERE campaign_id = $1
       ) s
      WHERE c.id = $1`,
    [campaignId]
  );
}

async function countQueued(client: Client, campaignId: string): Promise<number> {
  const result = await client.query(
    `SELECT count(*) AS count
       FROM newsletter_deliveries
      WHERE campaign_id = $1 AND status IN ('queued', 'sending')`,
    [campaignId]
  );

  return Number((result.rows[0] as { count: string }).count);
}

async function continueInNewInvocation(campaignId: string): Promise<void> {
  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!functionName) return;

  await lambda.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'Event',
      Payload: JSON.stringify({ campaignId }),
    })
  );
}
