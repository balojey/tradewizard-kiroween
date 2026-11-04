/**
 * Newsletter campaigns (portal).
 *
 * Sending is a privileged act: owner-only, fresh auth, a reason, and a claim that
 * makes a retried click a no-op. The heavy lifting lives in `newsletter-send`;
 * this module owns drafts, previews, test sends, and the snapshot that becomes
 * the audience for one issue.
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { requireFreshAuth } from '../../shared/admin-auth';
import { contentSchemaFor, type MarketBriefContent } from '../../shared/newsletter-content';
import { renderNewsletter } from '../../shared/newsletter-render';
import { generateCampaignSlug } from '../../shared/newsletter-slug';
import { sendEmail } from '../../shared/email';
import { createUnsubscribeToken } from '../../shared/newsletter-token';
import { withAudit } from '../lib/audit';
import { withClient } from '../lib/db';
import { parsePagination } from '../lib/pagination';
import { HttpError, json } from '../lib/responses';
import {
  campaignCancelSchema,
  campaignDraftSchema,
  campaignPreviewSchema,
  campaignSendSchema,
  parseBody,
} from '../lib/validation';
import type { AdminRoute, RouteContext } from '../lib/router';
import * as queries from '../queries/newsletter';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const lambda = new LambdaClient({});
const NEWSLETTER_FROM = process.env.NEWSLETTER_FROM_EMAIL || 'news@tradewizard.live';
const APP_URL = process.env.APP_URL || 'https://tradewizard.live';

function campaignId(params: Record<string, string>): string {
  const id = params.id;
  if (!id || !UUID_PATTERN.test(id)) {
    throw new HttpError(400, 'BAD_REQUEST', 'Invalid campaign id');
  }
  return id;
}

/** Validate the template payload with the schema the renderer will use. */
function parseContent(template: string, content: unknown): MarketBriefContent {
  const schema = contentSchemaFor(template);
  const result = schema.safeParse(content);

  if (!result.success) {
    const first = result.error.issues[0];
    throw new HttpError(400, 'BAD_REQUEST', first?.message ?? 'Invalid content', {
      field: first?.path.join('.') ?? null,
    });
  }

  return result.data as MarketBriefContent;
}

function issueDate(): string {
  return new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

async function renderFor(
  template: string,
  content: MarketBriefContent,
  subject: string,
  preheader: string | null,
  recipientName: string | null,
  unsubscribeEmail: string | null,
  slug: string | null
): Promise<{ html: string; text: string }> {
  const unsubscribeUrl = unsubscribeEmail
    ? `${APP_URL.replace(/\/+$/, '')}/unsubscribe?token=${encodeURIComponent(
        await createUnsubscribeToken(unsubscribeEmail)
      )}`
    : `${APP_URL.replace(/\/+$/, '')}/account`;

  return renderNewsletter({
    template: template as 'market_brief' | 'product_update',
    content: content as never,
    subject,
    preheader,
    recipientName,
    unsubscribeUrl,
    webViewUrl: slug ? `${APP_URL.replace(/\/+$/, '')}/newsletter/${slug}` : null,
    issueDate: issueDate(),
  });
}

export const newsletterRoutes: AdminRoute[] = [
  {
    method: 'GET',
    path: '/admin/newsletter/summary',
    minimumRole: 'admin',
    handler: async ({ event }: RouteContext) => {
      const summary = await withClient((client) => queries.campaignSummary(client));
      return json(event, 200, summary);
    },
  },

  {
    method: 'GET',
    path: '/admin/newsletter/subscribers',
    minimumRole: 'admin',
    handler: async ({ event }: RouteContext) => {
      const params = event.queryStringParameters ?? {};
      const status =
        params.status && ['subscribed', 'unsubscribed'].includes(params.status)
          ? params.status
          : undefined;

      const page = await withClient((client) =>
        queries.listSubscribers(
          client,
          { status, q: params.q?.trim() || undefined },
          parsePagination(params)
        )
      );

      return json(event, 200, page.items, { nextCursor: page.nextCursor });
    },
  },

  {
    method: 'GET',
    path: '/admin/newsletter/campaigns',
    minimumRole: 'admin',
    handler: async ({ event }: RouteContext) => {
      const params = event.queryStringParameters ?? {};
      const status =
        params.status && ['draft', 'sending', 'sent', 'failed', 'cancelled'].includes(params.status)
          ? params.status
          : undefined;

      const page = await withClient((client) =>
        queries.listCampaigns(client, { status }, parsePagination(params))
      );

      return json(event, 200, page.items, { nextCursor: page.nextCursor });
    },
  },

  {
    method: 'GET',
    path: '/admin/newsletter/campaigns/{id}',
    minimumRole: 'admin',
    handler: async ({ event, params }: RouteContext) => {
      const id = campaignId(params);

      const payload = await withClient(async (client) => {
        const campaign = await queries.getCampaign(client, id);
        if (!campaign) throw new HttpError(404, 'NOT_FOUND', 'Campaign not found');

        const deliveries = await queries.deliveryBreakdown(client, id);
        return { campaign, deliveries };
      });

      return json(event, 200, payload);
    },
  },

  {
    method: 'POST',
    path: '/admin/newsletter/campaigns',
    minimumRole: 'admin',
    handler: async ({ event, identity }: RouteContext) => {
      const input = parseBody(campaignDraftSchema, event.body);
      const content = parseContent(input.template, input.content);

      const campaign = await withClient((client) =>
        withAudit(
          client,
          {
            actor: identity,
            action: 'newsletter.campaign.create',
            targetType: 'newsletter_campaign',
            targetId: null,
            reason: input.reason,
            ip: event.requestContext?.identity?.sourceIp ?? null,
            requestId: event.requestContext?.requestId ?? null,
          },
          async () => {
            let created = null as Awaited<ReturnType<typeof queries.createCampaign>> | null;

            for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
              try {
                created = await queries.createCampaign(client, {
                  slug: generateCampaignSlug(),
                  subject: input.subject,
                  preheader: input.preheader ?? null,
                  template: input.template,
                  content: content as unknown as Record<string, unknown>,
                  createdBy: identity.email,
                });
              } catch (error) {
                const code = (error as { code?: string }).code;
                if (code !== '23505') throw error;
              }
            }

            if (!created) {
              throw new HttpError(500, 'INTERNAL', 'Could not allocate a campaign slug.');
            }

            return {
              result: created,
              after: { campaignId: created.id, subject: created.subject },
            };
          }
        )
      );

      return json(event, 201, campaign);
    },
  },

  {
    method: 'PUT',
    path: '/admin/newsletter/campaigns/{id}',
    minimumRole: 'admin',
    handler: async ({ event, identity, params }: RouteContext) => {
      const id = campaignId(params);
      const input = parseBody(campaignDraftSchema, event.body);
      const content = parseContent(input.template, input.content);

      const updated = await withClient(async (client) => {
        const before = await queries.getCampaign(client, id);
        if (!before) throw new HttpError(404, 'NOT_FOUND', 'Campaign not found');
        if (before.status !== 'draft') {
          throw new HttpError(409, 'CONFLICT', 'Only drafts can be edited.');
        }

        return withAudit(
          client,
          {
            actor: identity,
            action: 'newsletter.campaign.update',
            targetType: 'newsletter_campaign',
            targetId: id,
            reason: input.reason,
            before: { subject: before.subject, template: before.template },
            ip: event.requestContext?.identity?.sourceIp ?? null,
            requestId: event.requestContext?.requestId ?? null,
          },
          async () => {
            const row = await queries.updateCampaign(client, id, {
              subject: input.subject,
              preheader: input.preheader ?? null,
              template: input.template,
              content: content as unknown as Record<string, unknown>,
            });

            if (!row) {
              throw new HttpError(409, 'CONFLICT', 'Only drafts can be edited.');
            }

            return {
              result: row,
              after: { subject: row.subject, template: row.template },
            };
          }
        );
      });

      return json(event, 200, updated);
    },
  },

  {
    method: 'POST',
    path: '/admin/newsletter/campaigns/{id}/preview',
    minimumRole: 'admin',
    handler: async ({ event, params }: RouteContext) => {
      const id = campaignId(params);

      // Preview accepts unsaved edits so the composer can show the real render
      // before anything is written.
      const body = event.body ? parseBody(campaignPreviewSchema, event.body) : null;

      const campaign = await withClient((client) => queries.getCampaign(client, id));
      if (!campaign && !body) throw new HttpError(404, 'NOT_FOUND', 'Campaign not found');

      const content = body
        ? parseContent(body.template, body.content)
        : parseContent(campaign!.template, campaign!.content);

      const rendered = await renderFor(
        body?.template ?? campaign?.template ?? 'market_brief',
        content,
        body?.subject ?? campaign?.subject ?? '',
        body?.preheader ?? campaign?.preheader ?? null,
        null,
        null,
        campaign?.slug ?? null
      );

      return json(event, 200, { html: rendered.html });
    },
  },

  {
    method: 'POST',
    path: '/admin/newsletter/campaigns/{id}/test',
    minimumRole: 'admin',
    handler: async ({ event, identity, params }: RouteContext) => {
      const id = campaignId(params);

      const sent = await withClient(async (client) => {
        const campaign = await queries.getCampaign(client, id);
        if (!campaign) throw new HttpError(404, 'NOT_FOUND', 'Campaign not found');

        const content = parseContent(campaign.template, campaign.content);
        const rendered = await renderFor(
          campaign.template,
          content,
          campaign.subject,
          campaign.preheader,
          null,
          identity.email,
          campaign.slug
        );

        return withAudit(
          client,
          {
            actor: identity,
            action: 'newsletter.campaign.test',
            targetType: 'newsletter_campaign',
            targetId: id,
            reason: 'Test send to self',
            ip: event.requestContext?.identity?.sourceIp ?? null,
            requestId: event.requestContext?.requestId ?? null,
          },
          async () => {
            await sendEmail({
              to: identity.email,
              from: NEWSLETTER_FROM,
              subject: `[TEST] ${campaign.subject}`,
              html: rendered.html,
              text: rendered.text,
              headers: {
                'List-Unsubscribe': `<${APP_URL.replace(/\/+$/, '')}/account>`,
              },
            });

            return { result: { sentTo: identity.email } };
          }
        );
      });

      return json(event, 200, sent);
    },
  },

  {
    method: 'POST',
    path: '/admin/newsletter/campaigns/{id}/send',
    minimumRole: 'owner',
    handler: async ({ event, identity, params }: RouteContext) => {
      const id = campaignId(params);
      const input = parseBody(campaignSendSchema, event.body);

      requireFreshAuth(identity);

      const audience = await withClient((client) => queries.countAudience(client));
      if (audience === 0) {
        throw new HttpError(
          409,
          'CONFLICT',
          'There are no confirmed subscribers yet, so there is nobody to send to.'
        );
      }

      const result = await withClient((client) =>
        withAudit(
          client,
          {
            actor: identity,
            action: 'newsletter.campaign.send',
            targetType: 'newsletter_campaign',
            targetId: id,
            reason: input.reason,
            ip: event.requestContext?.identity?.sourceIp ?? null,
            requestId: event.requestContext?.requestId ?? null,
          },
          async () => {
            const claimed = await queries.claimCampaign(client, id, identity.email);
            if (!claimed) {
              throw new HttpError(
                409,
                'CONFLICT',
                'This campaign is already sending, sent, or cancelled.'
              );
            }

            const recipients = await queries.snapshotRecipients(client, id);

            return {
              result: { campaignId: id, recipients },
              after: { recipients, approvedBy: identity.email },
            };
          }
        )
      );

      // Dispatch outside the transaction/audit block: the Lambda owns the send,
      // and a failed dispatch must be reported rather than silently retried.
      const functionName = process.env.NEWSLETTER_SEND_FUNCTION_NAME;
      if (!functionName) {
        throw new HttpError(500, 'INTERNAL', 'Newsletter sender is not configured.');
      }

      try {
        await lambda.send(
          new InvokeCommand({
            FunctionName: functionName,
            InvocationType: 'Event',
            Payload: JSON.stringify({ campaignId: id }),
          })
        );
      } catch (error) {
        await withClient(async (client) => {
          await client.query(
            `UPDATE newsletter_campaigns
                SET status = 'failed', updated_at = now()
              WHERE id = $1 AND status = 'sending'`,
            [id]
          );
        });

        throw new HttpError(
          502,
          'UPSTREAM_FAILED',
          'The campaign was staged but the sender could not be started. Retry the send.'
        );
      }

      return json(event, 202, result);
    },
  },

  {
    method: 'POST',
    path: '/admin/newsletter/campaigns/{id}/cancel',
    minimumRole: 'owner',
    handler: async ({ event, identity, params }: RouteContext) => {
      const id = campaignId(params);
      const input = parseBody(campaignCancelSchema, event.body);

      const cancelled = await withClient((client) =>
        withAudit(
          client,
          {
            actor: identity,
            action: 'newsletter.campaign.cancel',
            targetType: 'newsletter_campaign',
            targetId: id,
            reason: input.reason,
            ip: event.requestContext?.identity?.sourceIp ?? null,
            requestId: event.requestContext?.requestId ?? null,
          },
          async () => {
            const row = await queries.cancelCampaign(client, id);
            if (!row) {
              throw new HttpError(
                409,
                'CONFLICT',
                'Only a draft or in-flight campaign can be cancelled.'
              );
            }

            return { result: row, after: { status: row.status } };
          }
        )
      );

      return json(event, 200, cancelled);
    },
  },
];
