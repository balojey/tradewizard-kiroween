/**
 * Request validation and context normalisation.
 *
 * The context payload arrives from a browser and is stored, emailed nowhere, and
 * later rendered in the portal, so it is treated as untrusted input: only
 * whitelisted keys, only scalar values, size-capped.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';

export const TOPICS = ['analysis', 'portfolio', 'billing', 'login', 'data', 'other'] as const;
export type SupportTopic = (typeof TOPICS)[number];

/** Keys the product may attach. Anything else is dropped server-side. */
const CONTEXT_KEYS = [
  'page',
  'marketId',
  'marketSlug',
  'analysisId',
  'sessionId',
  'plan',
  'recommendation',
  'appVersion',
] as const;

const MAX_CONTEXT_BYTES = 4_096;

const trimmed = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`)
    .transform(stripControlCharacters);

export const submitTicketSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Enter a valid email address')
    .max(254, 'Email must be at most 254 characters'),
  topic: z.enum(TOPICS),
  subject: trimmed(5, 140, 'Subject'),
  body: trimmed(20, 4000, 'Message'),
  context: z.record(z.string(), z.unknown()).optional(),
  requestId: z
    .string()
    .trim()
    .min(8, 'requestId must be at least 8 characters')
    .max(64, 'requestId must be at most 64 characters')
    .regex(/^[A-Za-z0-9_-]+$/, 'requestId may contain only letters, digits, - and _')
    .optional(),
});

export const postMessageSchema = z.object({
  body: trimmed(1, 4000, 'Message'),
  requestId: z
    .string()
    .trim()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});

export type SubmitTicketInput = z.infer<typeof submitTicketSchema>;

/**
 * Keep only known keys with scalar values. Objects and arrays are dropped rather
 * than stringified: nothing in the product needs them, and they are an easy way
 * to smuggle a large blob into the database.
 */
export function normaliseContext(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const source = raw as Record<string, unknown>;
  const context: Record<string, string> = {};

  for (const key of CONTEXT_KEYS) {
    const value = source[key];
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const text = stripControlCharacters(String(value)).trim();
    if (!text) continue;
    context[key] = text.slice(0, 200);
  }

  if (Buffer.byteLength(JSON.stringify(context)) > MAX_CONTEXT_BYTES) {
    return {};
  }

  return context;
}

/**
 * Dedupe fingerprint.
 *
 * `page` is excluded because it changes with navigation but not with the issue;
 * two submissions about the same analysis from different tabs are the same
 * request for help.
 */
export function contextHash(context: Record<string, string>): string {
  const { page: _page, ...stable } = context as Record<string, string>;
  const ordered = Object.keys(stable)
    .sort()
    .map((key) => [key, stable[key]]);

  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

function stripControlCharacters(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}
