/**
 * Ticket references, access tokens, and IP pseudonymisation.
 *
 * The access token is the only way an anonymous requester can read a thread, so
 * it is treated as a credential: random, stored hashed, compared in constant
 * time, and expiring.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import {
  ACCESS_TOKEN_TTL_DAYS as SHARED_TTL,
  accessTokenExpiry as sharedExpiry,
  generateAccessToken as sharedGenerate,
  hashToken as sharedHash,
} from '../../shared/support-token';

/** Unambiguous alphabet: no 0/O, 1/I/L, U. */
const REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const REF_LENGTH = 6;

export const ACCESS_TOKEN_TTL_DAYS = SHARED_TTL;

const secretsClient = new SecretsManagerClient({});
let cachedPepper: string | null = null;

/** Human handle such as `TW-4F2K9Q`. Collisions are handled by the unique index. */
export function generateRef(): string {
  const bytes = randomBytes(REF_LENGTH);
  let ref = '';
  for (let i = 0; i < REF_LENGTH; i += 1) {
    ref += REF_ALPHABET[bytes[i] % REF_ALPHABET.length];
  }
  return `TW-${ref}`;
}

/** Raw token, only ever present in the email link and the response to a resend. */
export const generateAccessToken = sharedGenerate;
export const hashToken = sharedHash;

/**
 * Compare a presented token against the stored hash without leaking length or
 * content through timing.
 */
export function tokenMatches(token: string, storedHash: string): boolean {
  if (!token || !storedHash) return false;

  const presented = Buffer.from(hashToken(token), 'hex');
  const expected = Buffer.from(storedHash, 'hex');

  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

export const accessTokenExpiry = sharedExpiry;

/**
 * Pseudonymise an IP address for abuse correlation.
 *
 * Salted because the IPv4 space is small enough to brute-force an unsalted
 * digest. The pepper lives in Secrets Manager, so rotating it breaks correlation
 * for new rows only — which is the right trade-off for data we keep for years.
 */
export async function hashIp(ip: string): Promise<string> {
  if (!ip) return '';

  const pepper = await getPepper();
  return createHash('sha256').update(pepper).update(':').update(ip).digest('hex');
}

async function getPepper(): Promise<string> {
  if (cachedPepper !== null) return cachedPepper;

  const secretArn = process.env.SUPPORT_IP_PEPPER_SECRET_ARN;
  if (!secretArn) {
    // Local tests run without the secret; an unsalted hash is still better than
    // storing the address itself.
    cachedPepper = '';
    return cachedPepper;
  }

  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );
  cachedPepper = response.SecretString ?? '';
  return cachedPepper;
}

/** Test seam: drop the cached pepper between cases. */
export function resetTokenCachesForTests(): void {
  cachedPepper = null;
}

/** Stable key for rate limits — never the raw address or email. */
export function rateKey(prefix: string, value: string): string {
  return `${prefix}#${createHash('sha256').update(value.trim().toLowerCase()).digest('hex')}`;
}
