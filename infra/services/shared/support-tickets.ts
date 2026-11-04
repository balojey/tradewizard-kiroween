/**
 * Thread-token persistence, shared by the public and admin APIs.
 *
 * Links are additive: every acknowledgement/reply issues a token, and any
 * unexpired token opens the thread. Rotating a single stored hash (the first
 * implementation) silently broke every earlier email, which is hostile to a
 * customer scrolling back to the first one.
 *
 * Only the SHA-256 hash is stored; the raw token exists in email and nowhere
 * else.
 */

import type { Client } from 'pg';
import { accessTokenExpiry, generateAccessToken, hashToken } from './support-token';

/** Issue a token for a ticket and return the raw value (email it immediately). */
export async function issueThreadToken(client: Client, ticketId: string): Promise<string> {
  const token = generateAccessToken();

  await client.query(
    `INSERT INTO support_thread_tokens (ticket_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [ticketId, hashToken(token), accessTokenExpiry()]
  );

  return token;
}

/** True when the presented hash belongs to this ticket and has not expired. */
export async function hasValidThreadToken(
  client: Client,
  ticketId: string,
  token: string
): Promise<boolean> {
  if (!token) return false;

  const result = await client.query(
    `SELECT 1
       FROM support_thread_tokens
      WHERE ticket_id = $1 AND token_hash = $2 AND expires_at > now()
      LIMIT 1`,
    [ticketId, hashToken(token)]
  );

  return (result.rowCount ?? 0) > 0;
}
