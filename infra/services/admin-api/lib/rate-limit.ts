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
import { HttpError } from './responses';

const READ_LIMIT = Number(process.env.ADMIN_API_RATE_LIMIT_RPM ?? 60);
const MUTATION_LIMIT = Number(process.env.ADMIN_API_MUTATION_RATE_LIMIT_RPM ?? 10);
const TTL_SECONDS = 120;

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
