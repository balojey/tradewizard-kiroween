/**
 * Resend delivery events.
 *
 * We subscribe only to what we act on: bounces and complaints. Opens and clicks
 * are deliberately not tracked (docs/newsletter-plan.md §2.4), so those events are
 * acknowledged and ignored.
 *
 * The signature is verified over the raw body before parsing: a forged request
 * here could suppress any address we choose.
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { withClient } from './lib/db';
import { HttpError, json, type ApiResponse } from './lib/http';
import { verifySvixSignature } from './lib/svix';
import * as queries from './lib/queries';

const secrets = new SecretsManagerClient({});
let cachedSecret: string | null = null;

interface WebhookEvent {
  body: string | null;
  headers?: Record<string, string | undefined>;
}

interface ResendEvent {
  type?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    bounce?: { type?: string; message?: string };
    bounce_type?: string;
  };
}

export async function handleResendWebhook(event: WebhookEvent): Promise<ApiResponse> {
  const payload = event.body ?? '';
  const secret = await getWebhookSecret();

  const id = header(event, 'svix-id');
  const timestamp = header(event, 'svix-timestamp');
  const signature = header(event, 'svix-signature');

  const valid = verifySvixSignature({ id, timestamp, signature }, payload, secret);
  if (!valid) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Invalid webhook signature.');
  }

  let parsed: ResendEvent;
  try {
    parsed = JSON.parse(payload) as ResendEvent;
  } catch {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Webhook body must be JSON.');
  }

  const type = parsed.type ?? '';
  const providerId = parsed.data?.email_id;
  const recipients = normaliseRecipients(parsed.data?.to);

  if (!providerId) return json(200, { ignored: true, reason: 'no email id' });

  if (type === 'email.bounced') {
    const bounceType = parsed.data?.bounce?.type ?? parsed.data?.bounce_type ?? '';
    const permanent = bounceType === '' || /permanent|permission/i.test(bounceType);

    const updated = await withClient((client) =>
      queries.markDeliveryByProviderId(
        client,
        providerId,
        'bounced',
        parsed.data?.bounce?.message ?? 'bounced'
      )
    );

    if (permanent) {
      await withClient(async (client) => {
        for (const email of recipients) {
          await queries.suppressEmail(client, email, 'bounced', providerId);
        }
      });
    }

    return json(200, { handled: 'bounced', permanent, updated });
  }

  if (type === 'email.complained') {
    const updated = await withClient((client) =>
      queries.markDeliveryByProviderId(
        client,
        providerId,
        'complained',
        'recipient marked this as spam'
      )
    );

    await withClient(async (client) => {
      for (const email of recipients) {
        await queries.suppressEmail(client, email, 'complained', providerId);
      }
    });

    return json(200, { handled: 'complained', updated });
  }

  return json(200, { ignored: true, type });
}

function header(event: WebhookEvent, name: string): string | undefined {
  return event.headers?.[name] ?? event.headers?.[name.toLowerCase()];
}

function normaliseRecipients(value: string[] | string | undefined): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value])
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.includes('@'));
}

async function getWebhookSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;

  const arn = process.env.RESEND_WEBHOOK_SECRET_ARN;
  if (!arn) {
    throw new HttpError(503, 'INTERNAL_ERROR', 'Webhook signing secret is not configured.');
  }

  const response = await secrets.send(new GetSecretValueCommand({ SecretId: arn }));
  if (!response.SecretString) {
    throw new HttpError(503, 'INTERNAL_ERROR', 'Webhook signing secret is empty.');
  }

  cachedSecret = response.SecretString;
  return cachedSecret;
}
