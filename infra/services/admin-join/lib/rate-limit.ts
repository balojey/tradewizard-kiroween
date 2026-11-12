/**
 * Rate limits for the unauthenticated join endpoints.
 *
 * This surface creates Cognito accounts and sends email, so it needs a budget
 * that does not depend on someone having a token. Counters live in the same
 * DynamoDB table as the portal's, with their own keys and TTLs.
 *
 * Failure policy is deliberately split:
 * - per-IP and per-link limits fail **open**, like the portal's: an unavailable
 *   counter must not block a legitimate invitee;
 * - the global daily cap fails **closed**: if the counter is unavailable there is
 *   no way to bound account creation and mail sending, so registration is
 *   refused with a retryable error rather than left unbounded.
 */

import { incrementCounter } from '../../shared/dynamo';
import { HttpError } from '../../admin-api/lib/responses';

const LOOKUP_PER_HOUR = 30;
const REGISTER_PER_IP_HOUR = 5;
const REGISTER_PER_LINK_HOUR = 10;
const GLOBAL_PER_DAY = Number(process.env.JOIN_GLOBAL_DAILY_LIMIT ?? 50);

const HOUR_TTL = 2 * 3600;
const DAY_TTL = 2 * 86_400;

function hourKey(): string {
  return new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
}

function dayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function clientIp(event: { requestContext?: { identity?: { sourceIp?: string } } }): string {
  return event.requestContext?.identity?.sourceIp ?? 'unknown';
}

async function countOrNull(key: string, bucket: string, ttl: number): Promise<number | null> {
  try {
    return await incrementCounter(key, bucket, ttl);
  } catch (error) {
    console.error('Join rate-limit counter unavailable', {
      bucket,
      error: (error as Error).message,
    });
    return null;
  }
}

export async function enforceLookupRateLimit(event: {
  requestContext?: { identity?: { sourceIp?: string } };
}): Promise<void> {
  const count = await countOrNull(`join#ip#${clientIp(event)}`, `lookup#${hourKey()}`, HOUR_TTL);

  if (count !== null && count > LOOKUP_PER_HOUR) {
    throw new HttpError(
      429,
      'RATE_LIMITED',
      'Too many link checks from this network. Wait a few minutes and try again.'
    );
  }
}

/**
 * Three counters: this network per hour, this link per hour, and the platform per
 * day. The link counter is passed only once the token has been resolved, so a
 * guessed token cannot consume another link's budget.
 */
export async function enforceRegisterRateLimit(
  event: { requestContext?: { identity?: { sourceIp?: string } } },
  linkId: string
): Promise<void> {
  const [ipCount, linkCount, globalCount] = await Promise.all([
    countOrNull(`join#ip#${clientIp(event)}`, `register#${hourKey()}`, HOUR_TTL),
    countOrNull(`join#link#${linkId}`, `register#${hourKey()}`, HOUR_TTL),
    countOrNull('join#global', `register#${dayKey()}`, DAY_TTL),
  ]);

  if (ipCount !== null && ipCount > REGISTER_PER_IP_HOUR) {
    throw new HttpError(
      429,
      'RATE_LIMITED',
      'Too many registrations from this network. Ask the owner for help if you are blocked.'
    );
  }

  if (linkCount !== null && linkCount > REGISTER_PER_LINK_HOUR) {
    throw new HttpError(
      429,
      'RATE_LIMITED',
      'This link has been used too many times this hour. Try again later or ask the owner for a new link.'
    );
  }

  // Fail closed. No counter means no bound, and the global cap is the only thing
  // standing between a leaked link and thousands of accounts.
  if (globalCount === null) {
    throw new HttpError(
      503,
      'UPSTREAM_FAILED',
      'Registration is temporarily unavailable. Try again in a few minutes.'
    );
  }

  if (globalCount > GLOBAL_PER_DAY) {
    throw new HttpError(
      429,
      'RATE_LIMITED',
      'The daily registration limit has been reached. Ask the owner to raise it or try tomorrow.'
    );
  }
}
