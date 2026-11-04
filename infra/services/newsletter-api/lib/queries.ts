/**
 * Newsletter consent persistence.
 *
 * One row per email. `status` is the consent state; suppression (bounce,
 * complaint) lives in its own table and is checked at send time.
 */

import type { Client } from 'pg';

export type ConsentSource =
  | 'signup_prompt'
  | 'account_toggle'
  | 'admin'
  | 'public_form'
  | 'unsubscribe_link';

export interface PortalUser {
  id: string;
  email: string;
  newsletterPromptedAt: string | null;
}

export interface SubscriptionRow {
  status: 'subscribed' | 'unsubscribed';
  source: ConsentSource;
  confirmedAt: string | null;
  unsubscribedAt: string | null;
}

export async function getPortalUser(
  client: Client,
  cognitoSub: string
): Promise<PortalUser | null> {
  const result = await client.query(
    `SELECT id, email, newsletter_prompted_at AS "newsletterPromptedAt"
       FROM users
      WHERE cognito_sub = $1
      LIMIT 1`,
    [cognitoSub]
  );

  return (result.rows[0] as PortalUser | undefined) ?? null;
}

export async function getSubscription(
  client: Client,
  email: string
): Promise<SubscriptionRow | null> {
  const result = await client.query(
    `SELECT status, source, confirmed_at AS "confirmedAt", unsubscribed_at AS "unsubscribedAt"
       FROM newsletter_subscribers
      WHERE email = $1
      LIMIT 1`,
    [email.trim().toLowerCase()]
  );

  return (result.rows[0] as SubscriptionRow | undefined) ?? null;
}

export async function upsertSubscription(
  client: Client,
  input: {
    email: string;
    userId: string | null;
    subscribed: boolean;
    source: ConsentSource;
    consentVersion: string | null;
    ipHash: string | null;
    userAgent: string | null;
  }
): Promise<SubscriptionRow> {
  const status = input.subscribed ? 'subscribed' : 'unsubscribed';

  const result = await client.query(
    `
    INSERT INTO newsletter_subscribers (
      email, user_id, status, source, consent_version, ip_hash, user_agent,
      confirmed_at, unsubscribed_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      CASE WHEN $3 = 'subscribed' THEN now() END,
      CASE WHEN $3 = 'unsubscribed' THEN now() END
    )
    ON CONFLICT (email) DO UPDATE SET
      status = EXCLUDED.status,
      user_id = COALESCE(EXCLUDED.user_id, newsletter_subscribers.user_id),
      source = EXCLUDED.source,
      consent_version = COALESCE(EXCLUDED.consent_version, newsletter_subscribers.consent_version),
      ip_hash = COALESCE(EXCLUDED.ip_hash, newsletter_subscribers.ip_hash),
      user_agent = COALESCE(EXCLUDED.user_agent, newsletter_subscribers.user_agent),
      confirmed_at = CASE
        WHEN EXCLUDED.status = 'subscribed'
          THEN COALESCE(newsletter_subscribers.confirmed_at, now())
        ELSE newsletter_subscribers.confirmed_at
      END,
      unsubscribed_at = CASE
        WHEN EXCLUDED.status = 'unsubscribed' THEN now()
        ELSE NULL
      END,
      updated_at = now()
    RETURNING status, source, confirmed_at AS "confirmedAt", unsubscribed_at AS "unsubscribedAt"
    `,
    [
      input.email.trim().toLowerCase(),
      input.userId,
      status,
      input.source,
      input.consentVersion,
      input.ipHash,
      input.userAgent,
    ]
  );

  return result.rows[0] as SubscriptionRow;
}

/** Record that this account answered the one-time prompt (either answer). */
export async function markPrompted(client: Client, userId: string): Promise<void> {
  await client.query(
    `UPDATE users
        SET newsletter_prompted_at = COALESCE(newsletter_prompted_at, now())
      WHERE id = $1`,
    [userId]
  );
}

export interface PublicCampaign {
  slug: string;
  subject: string;
  preheader: string | null;
  template: string;
  content: unknown;
  sentAt: string | null;
  startedAt: string | null;
  createdAt: string;
}

/** Published issues only: a draft must never be readable by URL. */
export async function getPublicCampaignBySlug(
  client: Client,
  slug: string
): Promise<PublicCampaign | null> {
  const result = await client.query(
    `SELECT slug, subject, preheader, template, content,
            sent_at AS "sentAt", started_at AS "startedAt", created_at AS "createdAt"
       FROM newsletter_campaigns
      WHERE slug = $1 AND status IN ('sent', 'sending')
      LIMIT 1`,
    [slug]
  );

  return (result.rows[0] as PublicCampaign | undefined) ?? null;
}

/** Mark the delivery a provider event refers to. Unknown ids are ignored. */
export async function markDeliveryByProviderId(
  client: Client,
  providerMessageId: string,
  status: 'bounced' | 'complained' | 'sent',
  error: string | null
): Promise<number> {
  const result = await client.query(
    `UPDATE newsletter_deliveries
        SET status = $2, error = $3
      WHERE provider_message_id = $1
        AND status IN ('sent', 'bounced', 'complained')`,
    [providerMessageId, status, error]
  );

  return result.rowCount ?? 0;
}

/** Suppression is permanent until an operator removes it. */
export async function suppressEmail(
  client: Client,
  email: string,
  reason: 'bounced' | 'complained' | 'manual',
  note: string | null
): Promise<void> {
  await client.query(
    `INSERT INTO newsletter_suppressions (email, reason, note)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET
       reason = EXCLUDED.reason,
       note = EXCLUDED.note`,
    [email.trim().toLowerCase(), reason, note]
  );
}
