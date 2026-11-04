/**
 * Public web view of a published issue.
 *
 * Rendered on demand from the same content the email used, with a generic
 * greeting and a preferences link instead of a recipient's unsubscribe token.
 * Only `sent`/`sending` campaigns resolve — a draft must never be readable by
 * guessing a slug.
 */

import { withClient } from './lib/db';
import { htmlResponse, HttpError, type ApiResponse } from './lib/http';
import * as queries from './lib/queries';
import { renderNewsletter } from '../shared/newsletter-render';

const APP_URL = (process.env.APP_URL || 'https://tradewizard.live').replace(/\/+$/, '');

export async function handleWebView(slug: string): Promise<ApiResponse> {
  const campaign = await withClient((client) =>
    queries.getPublicCampaignBySlug(client, slug)
  );

  if (!campaign) {
    throw new HttpError(404, 'NOT_FOUND', 'No issue matches that link.');
  }

  const date = campaign.sentAt ?? campaign.startedAt ?? campaign.createdAt;

  const rendered = await renderNewsletter({
    template: campaign.template as 'market_brief' | 'product_update',
    content: campaign.content as never,
    subject: campaign.subject,
    preheader: campaign.preheader,
    recipientName: null,
    unsubscribeUrl: `${APP_URL}/account`,
    webViewUrl: null,
    issueDate: new Date(date).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }),
  });

  return htmlResponse(rendered.html);
}
