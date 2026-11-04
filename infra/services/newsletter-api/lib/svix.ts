/**
 * Svix webhook signature verification (Resend signs with Svix).
 *
 * Why implement it rather than pull in the SDK: we verify one header format and
 * nothing else, and the algorithm is small enough to read. Wrong here means
 * anyone can suppress arbitrary addresses or forge delivery events.
 *
 * Format: `svix-signature: v1,<base64 hmac> [v1,<...>]`, over
 * `${svix-id}.${svix-timestamp}.${rawBody}`, with the secret base64-decoded after
 * the `whsec_` prefix. Timestamps outside the tolerance are rejected so a captured
 * request cannot be replayed later.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

export interface SvixHeaders {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

export function verifySvixSignature(
  headers: SvixHeaders,
  payload: string,
  secret: string,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;

  const age = Math.abs(Date.now() / 1000 - timestampSeconds);
  if (age > toleranceSeconds) return false;

  const key = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;

  let keyBytes: Buffer;
  try {
    keyBytes = Buffer.from(key, 'base64');
  } catch {
    return false;
  }

  const expected = createHmac('sha256', keyBytes)
    .update(`${id}.${timestamp}.${payload}`)
    .digest('base64');

  const expectedBuffer = Buffer.from(expected);

  return signature.split(' ').some((entry) => {
    const [version, value] = entry.split(',');
    if (version !== 'v1' || !value) return false;

    const provided = Buffer.from(value);
    return (
      provided.length === expectedBuffer.length &&
      timingSafeEqual(provided, expectedBuffer)
    );
  });
}
