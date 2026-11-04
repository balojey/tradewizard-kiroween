/**
 * Request body validation.
 *
 * Every mutation body is parsed here with zod. The schemas are the contract:
 * unknown fields are stripped, strings are bounded, and reasons are mandatory
 * because they land in the audit log.
 */

import { z } from 'zod';
import { HttpError } from './responses';

/** Every mutation requires a human-readable reason. */
const reason = z
  .string()
  .trim()
  .min(8, 'Reason must be at least 8 characters')
  .max(500, 'Reason must be at most 500 characters');

export const noteSchema = z.object({
  body: z.string().trim().min(1, 'Note cannot be empty').max(2000, 'Note is too long'),
  reason,
});

export const creditGrantSchema = z.object({
  amount: z.number().int().min(1).max(100_000),
  reason,
});

export const statusChangeSchema = z.object({
  status: z.enum(['active', 'suspended', 'banned']),
  reason,
});

export const planOverrideSchema = z.object({
  plan: z.enum(['free', 'starter', 'pro', 'elite']),
  expiresAt: z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid expiry date')
    .nullable()
    .optional(),
  reason,
});

export const revokeSchema = z.object({ reason });

export const requeueSchema = z.object({
  marketId: z
    .string()
    .trim()
    .min(8, 'Market id looks too short')
    .max(200, 'Market id looks too long'),
  reason,
});

export type NoteInput = z.infer<typeof noteSchema>;
export type CreditGrantInput = z.infer<typeof creditGrantSchema>;

/** Parse a JSON body or throw a 400 with the first validation message. */
export function parseBody<T>(schema: z.ZodType<T>, raw: string | null | undefined): T {
  let parsed: unknown;

  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', 'Body must be valid JSON');
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new HttpError(400, 'BAD_REQUEST', first?.message ?? 'Invalid request body', {
      field: first?.path.join('.') ?? null,
    });
  }

  return result.data;
}

/** Optional `Idempotency-Key` header, bounded so it cannot be abused as storage. */
export function idempotencyKey(
  headers: Record<string, string | undefined> | null | undefined
): string | null {
  const raw = headers?.['idempotency-key'] ?? headers?.['Idempotency-Key'];
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return null;
  return trimmed;
}

// ─── Support ──────────────────────────────────────────────────────────────────

const supportStatus = z.enum(['open', 'pending', 'resolved', 'closed']);
const supportPriority = z.enum(['low', 'normal', 'high', 'urgent']);

export const supportReplySchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Reply cannot be empty')
    .max(4000, 'Reply is too long'),
  /** Internal notes never email and never appear in the customer thread. */
  internal: z.boolean().optional(),
  requestId: z
    .string()
    .trim()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});

export const supportUpdateSchema = z
  .object({
    status: supportStatus.optional(),
    priority: supportPriority.optional(),
    /** `null` releases the ticket; a sub assigns it (admin override). */
    assignedAdminSub: z.string().trim().min(1).max(256).nullable().optional(),
    reason,
  })
  .refine(
    (value) =>
      value.status !== undefined ||
      value.priority !== undefined ||
      value.assignedAdminSub !== undefined,
    { message: 'Provide at least one change' }
  );

// ─── Newsletter ───────────────────────────────────────────────────────────────

const newsletterTemplate = z.enum(['market_brief', 'product_update']);

export const campaignContentSchema = z.object({
  subject: z.string().trim().min(4, 'Subject is too short').max(140),
  preheader: z.string().trim().max(140).optional(),
  template: newsletterTemplate,
  content: z.record(z.string(), z.unknown()),
});

export const campaignDraftSchema = campaignContentSchema.extend({ reason });

export const campaignPreviewSchema = campaignContentSchema;

export const campaignSendSchema = z.object({ reason });

export const campaignCancelSchema = z.object({ reason });
