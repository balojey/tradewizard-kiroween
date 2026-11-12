/**
 * Per-admin request limits.
 *
 * Two buckets, because reading a table and moving credits are not equivalent
 * risks. Counters live in the rate-limit DynamoDB table with a two-minute TTL, so
 * they expire on their own.
 *
 * Fails **open**: an unavailable counter must not take the portal down. The
 * limits exist to protect the database from a runaway dashboard, not as a
 * security boundary (that is the authorizer's job).
 */

import { incrementCounter } from '../../shared/dynamo';
import type { AdminIdentity } from '../../shared/admin-auth';
import { getSetting, warmSettings } from '../../shared/settings';
import { HttpError } from './responses';

const READ_LIMIT = Number(process.env.ADMIN_API_RATE_LIMIT_RPM ?? 60);
const MUTATION_LIMIT = Number(process.env.ADMIN_API_MUTATION_RATE_LIMIT_RPM ?? 10);
const TTL_SECONDS = 120;

/** Copilot limits are separate: every request is a model call, not a query. */
const COPILOT_RPM = Number(process.env.ADMIN_COPILOT_RATE_LIMIT_RPM ?? 10);
const COPILOT_DAILY_FALLBACK = 100;
const DAILY_TTL_SECONDS = 2 * 86_400;

export async function enforceRateLimit(
  identity: AdminIdentity,
  isMutation: boolean
): Promise<void> {
  const window = new Date().toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
  const bucket = isMutation ? 'mutation' : 'read';
  const limit = isMutation ? MUTATION_LIMIT : READ_LIMIT;

  let count: number;

  try {
    count = await incrementCounter(`admin#${identity.sub}`, `${bucket}#${window}`, TTL_SECONDS);
  } catch (error) {
    console.error('Admin rate limit unavailable; allowing the request', error);
    return;
  }

  if (count > limit) {
    throw new HttpError(
      429,
      'RATE_LIMITED',
      isMutation
        ? `Too many changes in a minute (limit ${limit}). Wait a moment and retry.`
        : `Too many requests in a minute (limit ${limit}). Wait a moment and retry.`
    );
  }
}

/**
 * Copilot budget: 10/minute and a configurable daily cap per operator.
 *
 * Two counters rather than one because they answer different questions: the
 * minute bucket stops a double-click storm, the day bucket stops a slow leak.
 * Both fail open — a counter outage must not remove the portal's ability to read
 * its own incident context.
 */
export async function enforceCopilotRateLimit(identity: AdminIdentity): Promise<void> {
  const now = new Date();
  const minute = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
  const day = now.toISOString().slice(0, 10);

  await warmSettings(['copilot_daily_limit']);
  const configured = Number(await getSetting('copilot_daily_limit'));
  const dailyLimit =
    Number.isFinite(configured) && configured > 0 ? configured : COPILOT_DAILY_FALLBACK;

  let minuteCount: number;
  let dayCount: number;

  try {
    [minuteCount, dayCount] = await Promise.all([
      incrementCounter(`admin#${identity.sub}`, `copilot-minute#${minute}`, TTL_SECONDS),
      incrementCounter(`admin#${identity.sub}`, `copilot-day#${day}`, DAILY_TTL_SECONDS),
    ]);
  } catch (error) {
    console.error('Copilot rate limit unavailable; allowing the request', error);
    return;
  }

  if (minuteCount > COPILOT_RPM) {
    throw new HttpError(
      429,
      'RATE_LIMITED',
      `Too many copilot questions in a minute (limit ${COPILOT_RPM}). Wait a moment and retry.`
    );
  }

  if (dayCount > dailyLimit) {
    throw new HttpError(
      429,
      'RATE_LIMITED',
      `Daily copilot budget reached (limit ${dailyLimit}). Ask an owner to raise "copilot_daily_limit" or retry tomorrow.`
    );
  }
}
