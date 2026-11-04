/**
 * Newsletter API — consent and unsubscribe (Phase 1).
 *
 * Routes:
 *   GET  /user/newsletter              consent status for the signed-in account
 *   POST /user/newsletter              { optedIn, source } — record consent
 *   POST /user/newsletter/dismiss      answered the prompt without subscribing
 *   GET  /newsletter/unsubscribe       token validity for the public page
 *   POST /newsletter/unsubscribe       one-click unsubscribe (RFC 8058), idempotent
 *
 * Marketing consent is explicit (docs/newsletter-plan.md §3): the product prompt
 * is affirmative, the account toggle is durable, and no pre-checked box exists
 * anywhere. Unsubscribing always works, even when the newsletter is disabled.
 */

import { getSettingSync, warmSettings } from '../shared/settings';
import { hashConsentIp, readUnsubscribeToken } from '../shared/newsletter-token';
import { incrementCounter } from '../shared/dynamo';
import { withClient } from './lib/db';
import { errorResponse, HttpError, json, preflight, tokenKey, type ApiResponse } from './lib/http';
import * as queries from './lib/queries';
import { handleWebView } from './web';
import { handleResendWebhook } from './webhook';

const CONSENT_VERSION = '2026-11-04';

interface NewsletterEvent {
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

export async function handler(event: NewsletterEvent): Promise<ApiResponse> {
  try {
    if (event.httpMethod === 'OPTIONS') return preflight();

    const path = event.path.replace(/\/+$/, '');
    const method = event.httpMethod.toUpperCase();

    if (path === '/user/newsletter' && method === 'GET') return await handleStatus(event);
    if (path === '/user/newsletter' && method === 'POST') return await handleOptIn(event);
    if (path === '/user/newsletter/dismiss' && method === 'POST') return await handleDismiss(event);
    if (path === '/newsletter/unsubscribe' && method === 'GET') return await handleTokenCheck(event);
    if (path === '/newsletter/unsubscribe' && method === 'POST') return await handleUnsubscribe(event);

    if (path === '/newsletter/webhook/resend' && method === 'POST') {
      return await handleResendWebhook(event);
    }

    const webMatch = path.match(/^\/newsletter\/web\/([^/]+)$/);
    if (webMatch && method === 'GET') {
      return await handleWebView(decodeURIComponent(webMatch[1]));
    }

    throw new HttpError(404, 'NOT_FOUND', 'Unknown newsletter route.');
  } catch (caught) {
    if (caught instanceof HttpError) return errorResponse(caught);
    console.error('NewsletterApi error', caught);
    return errorResponse(
      new HttpError(500, 'INTERNAL_ERROR', 'Something went wrong on our side.')
    );
  }
}

// ─── Account consent ──────────────────────────────────────────────────────────

async function handleStatus(event: NewsletterEvent): Promise<ApiResponse> {
  const sub = requireSub(event);

  await warmSettings(['newsletter_enabled']);
  const available = getSettingSync('newsletter_enabled') !== false;

  const payload = await withClient(async (client) => {
    const user = await queries.getPortalUser(client, sub);
    if (!user) throw new HttpError(404, 'NOT_FOUND', 'Account not found.');

    const subscription = await queries.getSubscription(client, user.email);

    return {
      status: subscription?.status ?? 'none',
      promptedAt: user.newsletterPromptedAt,
      email: user.email,
      consentVersion: CONSENT_VERSION,
      available,
    };
  });

  return json(200, payload);
}

async function handleOptIn(event: NewsletterEvent): Promise<ApiResponse> {
  const sub = requireSub(event);
  await assertEnabled();

  const body = readJson(event);
  if (typeof body.optIn !== 'boolean') {
    throw new HttpError(422, 'VALIDATION_ERROR', 'optIn must be true or false.');
  }

  const source = body.source === 'signup_prompt' ? 'signup_prompt' : 'account_toggle';
  const ip = event.requestContext?.identity?.sourceIp ?? '';

  const payload = await withClient(async (client) => {
    const user = await queries.getPortalUser(client, sub);
    if (!user) throw new HttpError(404, 'NOT_FOUND', 'Account not found.');

    const subscription = await queries.upsertSubscription(client, {
      email: user.email,
      userId: user.id,
      subscribed: body.optIn as boolean,
      source,
      consentVersion: body.optIn === true ? CONSENT_VERSION : null,
      ipHash: await hashConsentIp(ip),
      userAgent: event.headers?.['user-agent'] ?? event.headers?.['User-Agent'] ?? null,
    });

    // Answering the prompt — either way — means it is not shown again.
    await queries.markPrompted(client, user.id);

    return { status: subscription.status, source: subscription.source };
  });

  return json(200, { ...payload, promptedAt: new Date().toISOString() });
}

async function handleDismiss(event: NewsletterEvent): Promise<ApiResponse> {
  const sub = requireSub(event);

  const promptedAt = await withClient(async (client) => {
    const user = await queries.getPortalUser(client, sub);
    if (!user) throw new HttpError(404, 'NOT_FOUND', 'Account not found.');

    await queries.markPrompted(client, user.id);
    return new Date().toISOString();
  });

  return json(200, { promptedAt });
}

// ─── Unsubscribe (public) ─────────────────────────────────────────────────────

async function handleTokenCheck(event: NewsletterEvent): Promise<ApiResponse> {
  const token = event.queryStringParameters?.token ?? '';

  // Cheap ceiling: a token-guessing loop must not cost a decrypt each time.
  await enforceUnsubscribeLimit(token);

  const email = await readUnsubscribeToken(token);
  if (!email) throw new HttpError(400, 'INVALID_TOKEN', 'This unsubscribe link is not valid.');

  return json(200, { valid: true });
}

async function handleUnsubscribe(event: NewsletterEvent): Promise<ApiResponse> {
  const token = event.queryStringParameters?.token ?? '';
  await enforceUnsubscribeLimit(token);

  const email = await readUnsubscribeToken(token);
  if (!email) throw new HttpError(400, 'INVALID_TOKEN', 'This unsubscribe link is not valid.');

  const subscription = await withClient((client) =>
    queries.upsertSubscription(client, {
      email,
      userId: null,
      subscribed: false,
      source: 'unsubscribe_link',
      consentVersion: null,
      ipHash: null,
      userAgent: null,
    })
  );

  return json(200, { status: subscription.status });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requireSub(event: NewsletterEvent): string {
  const sub = event.requestContext?.authorizer?.claims?.sub;
  if (!sub) throw new HttpError(401, 'UNAUTHORIZED', 'Sign in to manage your email preferences.');
  return sub;
}

/**
 * The kill switch hides the prompt and refuses new opt-ins. Unsubscribe is
 * deliberately exempt: someone must always be able to leave.
 */
async function assertEnabled(): Promise<void> {
  await warmSettings(['newsletter_enabled']);

  if (getSettingSync('newsletter_enabled') === false) {
    throw new HttpError(
      409,
      'NEWSLETTER_DISABLED',
      'The newsletter is not available right now.'
    );
  }
}

async function enforceUnsubscribeLimit(token: string): Promise<void> {
  const minute = new Date().toISOString().slice(0, 16);
  const count = await incrementCounter(
    `newsletter#unsubscribe#${tokenKey(token)}`,
    minute,
    90
  );

  if (count > 30) {
    throw new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Please try again shortly.');
  }
}

function readJson(event: NewsletterEvent): Record<string, unknown> {
  if (!event.body) return {};

  try {
    const parsed = JSON.parse(event.body) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, 'VALIDATION_ERROR', 'The request body must be valid JSON.');
  }
}
