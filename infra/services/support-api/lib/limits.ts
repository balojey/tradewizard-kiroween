/**
 * Abuse limits for an endpoint that accepts anonymous traffic.
 *
 * Three ceilings, cheapest defence first:
 * - per requester email (3/hour) — one person cannot flood the queue
 * - per IP (10/hour) — one script cannot flood it either
 * - global (120/minute) — a burst cannot exhaust the database or the email quota
 *
 * Counters live in the shared rate-limit table; there is no new infrastructure.
 */

import { incrementCounter } from '../../shared/dynamo';
import { HttpError } from './http';
import { rateKey } from './tokens';

const HOUR_SECONDS = 3_600;
const MINUTE_SECONDS = 60;

const EMAIL_TICKETS_PER_HOUR = 3;
const IP_TICKETS_PER_HOUR = 10;
const GLOBAL_TICKETS_PER_MINUTE = 120;
const MESSAGES_PER_HOUR = 6;

function hourWindow(now: Date = new Date()): string {
  return now.toISOString().slice(0, 13);
}

function minuteWindow(now: Date = new Date()): string {
  return now.toISOString().slice(0, 16);
}

export async function enforceSubmitLimits(email: string, ip: string): Promise<void> {
  const hour = hourWindow();

  const globalCount = await incrementCounter(
    'support#global',
    minuteWindow(),
    MINUTE_SECONDS + 30
  );
  if (globalCount > GLOBAL_TICKETS_PER_MINUTE) {
    throw new HttpError(
      503,
      'SUPPORT_DISABLED',
      'Support is receiving unusually high traffic. Please try again shortly.'
    );
  }

  const emailCount = await incrementCounter(rateKey('support#email', email), hour, HOUR_SECONDS + 60);
  if (emailCount > EMAIL_TICKETS_PER_HOUR) {
    throw new HttpError(
      429,
      'RATE_LIMITED',
      'You have sent several requests in the last hour. Please wait for our reply before sending more.',
      { retryAfterSeconds: 3_600 }
    );
  }

  if (ip) {
    const ipCount = await incrementCounter(rateKey('support#ip', ip), hour, HOUR_SECONDS + 60);
    if (ipCount > IP_TICKETS_PER_HOUR) {
      throw new HttpError(
        429,
        'RATE_LIMITED',
        'Too many requests from this connection. Please try again later.',
        { retryAfterSeconds: 3_600 }
      );
    }
  }
}

export async function enforceMessageLimit(ticketId: string): Promise<void> {
  const count = await incrementCounter(
    `support#ticket#${ticketId}`,
    hourWindow(),
    HOUR_SECONDS + 60
  );

  if (count > MESSAGES_PER_HOUR) {
    throw new HttpError(
      429,
      'RATE_LIMITED',
      'You have sent several messages on this request in the last hour. Please wait a little.',
      { retryAfterSeconds: 3_600 }
    );
  }
}
