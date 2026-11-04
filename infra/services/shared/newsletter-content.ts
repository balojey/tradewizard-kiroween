/**
 * Newsletter content contracts.
 *
 * Shared by the portal (form validation) and the renderer/sender, so an operator
 * cannot save content the sender would refuse to render — and the preview uses
 * exactly the same data shape as the real send.
 */

import { z } from 'zod';

export const TEMPLATES = ['market_brief', 'product_update'] as const;
export type NewsletterTemplate = (typeof TEMPLATES)[number];

const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => value === '' || /^https?:\/\//.test(value), {
    message: 'Link must start with http:// or https://',
  })
  .optional();

export const marketBriefContentSchema = z.object({
  heroTitle: z.string().trim().min(4, 'Give the issue a headline').max(90),
  intro: z.string().trim().min(10, 'Write a short introduction').max(600),
  picks: z
    .array(
      z.object({
        question: z.string().trim().min(4, 'Pick a market').max(160),
        /** AI fair probability, 0–100. */
        aiProbability: z.number().min(0).max(100),
        /** Market-implied probability at the time of writing, 0–100. */
        marketProbability: z.number().min(0).max(100),
        read: z.string().trim().min(4, 'Say what the agents concluded').max(240),
        url: optionalUrl,
      })
    )
    .min(1, 'Include at least one market')
    .max(4, 'Keep it to four markets at most'),
  closing: z.string().trim().max(500).optional(),
});

export type MarketBriefContent = z.infer<typeof marketBriefContentSchema>;

export const productUpdateContentSchema = z.object({
  heroTitle: z.string().trim().min(4, 'Give the update a headline').max(90),
  intro: z.string().trim().min(10, 'Write a short introduction').max(600),
  sections: z
    .array(
      z.object({
        heading: z.string().trim().min(3, 'Give the section a heading').max(110),
        body: z.string().trim().min(10, 'Say what changed').max(700),
        ctaLabel: z.string().trim().max(40).optional(),
        ctaUrl: optionalUrl,
      })
    )
    .min(1, 'Include at least one section')
    .max(3, 'Keep it to three sections at most'),
  closing: z.string().trim().max(500).optional(),
});

export type ProductUpdateContent = z.infer<typeof productUpdateContentSchema>;
export type NewsletterContent = MarketBriefContent | ProductUpdateContent;

export function contentSchemaFor(template: string) {
  if (template === 'market_brief') return marketBriefContentSchema;
  if (template === 'product_update') return productUpdateContentSchema;
  throw new Error(`Unknown newsletter template: ${template}`);
}

export function isTemplate(value: string): value is NewsletterTemplate {
  return (TEMPLATES as readonly string[]).includes(value);
}
