/**
 * Unsubscribe tokens.
 *
 * The token is an encrypted payload (AES-256-GCM) rather than a stored hash or a
 * signed email, for three reasons:
 * - old emails keep working with no database lookup;
 * - the address never appears in a URL, a referrer, or a mail-provider log;
 * - a link is deterministic only at render time, which is fine because
 *   unsubscribe never needs to be recomputed for an earlier issue.
 *
 * Rotating the key invalidates every outstanding link, so treat it as permanent.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

const VERSION = 1;

const secretsClient = new SecretsManagerClient({});
let cachedKey: Buffer | null = null;

async function getKey(): Promise<Buffer> {
  if (cachedKey) return cachedKey;

  const arn = process.env.NEWSLETTER_TOKEN_SECRET_ARN;
  if (!arn) {
    throw new Error('NEWSLETTER_TOKEN_SECRET_ARN environment variable is not set');
  }

  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: arn })
  );

  const secret = response.SecretString;
  if (!secret) throw new Error('Newsletter token secret has no value');

  // Any length becomes a 32-byte key.
  cachedKey = createHash('sha256').update(secret).digest();
  return cachedKey;
}

/** Encrypt an address into a URL-safe unsubscribe token. */
export async function createUnsubscribeToken(email: string): Promise<string> {
  const key = await getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const payload = JSON.stringify({ e: email.trim().toLowerCase(), v: VERSION });
  const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, ciphertext]).toString('base64url');
}

/**
 * Decrypt a token. Returns `null` for anything malformed, tampered with, or from
 * a previous key — the caller treats all three as "invalid link".
 */
export async function readUnsubscribeToken(token: string): Promise<string | null> {
  if (!token) return null;

  try {
    const key = await getKey();
    const raw = Buffer.from(token, 'base64url');
    if (raw.length <= 28) return null;

    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');

    const parsed = JSON.parse(plaintext) as { e?: unknown; v?: unknown };
    if (parsed.v !== VERSION || typeof parsed.e !== 'string' || !parsed.e.includes('@')) {
      return null;
    }

    return parsed.e.trim().toLowerCase();
  } catch {
    return null;
  }
}

/** Pseudonymised IP for the consent record. Never stores the address itself. */
export async function hashConsentIp(ip: string): Promise<string | null> {
  if (!ip) return null;
  const key = await getKey();
  return createHmac('sha256', key).update(ip).digest('hex');
}

/** Test seam: drop the cached key. */
export function resetNewsletterTokenCacheForTests(): void {
  cachedKey = null;
}
