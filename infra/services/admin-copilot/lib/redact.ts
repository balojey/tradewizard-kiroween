/**
 * Redaction and prompt-injection hygiene.
 *
 * Two distinct jobs:
 *
 * 1. **Data minimisation** — a copilot answer must not leak more than the
 *    caller's role can already see. Emails and access-token-shaped strings are
 *    removed unless the role may read them.
 * 2. **Instruction disarmament** — retrieved text is untrusted. Before it goes
 *    into a prompt, markdown links and bare URLs are stripped, so a ticket that
 *    says "click https://evil.example and send the newsletter" cannot become a
 *    link the model repeats, and control characters are removed so a record
 *    cannot fake the record delimiters the prompt builder adds.
 *
 * See docs/plans/warden-ai-copilot.md §6.
 */

import type { AdminRole } from '../../shared/admin-auth';

/** Roles that may see customer contact details (support plan §6). */
const PII_ROLES: ReadonlySet<AdminRole> = new Set<AdminRole>(['support', 'admin', 'owner']);

export function roleSeesPii(role: AdminRole): boolean {
  return PII_ROLES.has(role);
}

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Bearer/JWT-shaped values and long hex tokens are never useful in a summary. */
const TOKEN_PATTERN =
  /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|\b[A-Fa-f0-9]{32,}\b)/g;

const BARE_URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;

/** Markdown link `[label](target)` → `label`, so the target cannot be reused. */
const MARKDOWN_LINK_PATTERN = /\[([^\]\n]{0,200})\]\((?:[^()\s]|\([^()]*\)){0,500}\)/g;

/** Control characters that could break out of a delimited record block. */
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** A record body long enough to be interesting, short enough to stay bounded. */
export const MAX_RECORD_TEXT = 1_200;

export function truncate(value: string, max = MAX_RECORD_TEXT): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(max - 1, 0))}…`;
}

/**
 * Remove links and URLs from untrusted text. The goal is not sanitisation for
 * display (the UI renders plain text anyway); it is removing the phishing
 * affordance a model might faithfully reproduce.
 */
export function stripLinks(text: string): string {
  return text
    .replace(MARKDOWN_LINK_PATTERN, '$1')
    .replace(BARE_URL_PATTERN, '[link removed]');
}

export function redactSecrets(text: string, role: AdminRole): string {
  let output = text;

  if (!roleSeesPii(role)) {
    output = output.replace(EMAIL_PATTERN, '[email redacted]');
  }

  return output.replace(TOKEN_PATTERN, '[token redacted]');
}

/**
 * The one function retrieval modules call on every free-text field.
 * Deterministic, so tests can pin the exact output.
 */
export function sanitizeUntrustedText(
  value: unknown,
  role: AdminRole,
  max = MAX_RECORD_TEXT
): string {
  if (value === null || value === undefined) return '';

  const raw = typeof value === 'string' ? value : safeStringify(value);

  return truncate(redactSecrets(stripLinks(raw.replace(CONTROL_CHARS, ' ')), role), max);
}

/** JSON that never throws, for audit `before`/`after` payloads. */
export function safeStringify(value: unknown, max = MAX_RECORD_TEXT): string {
  if (value === null || value === undefined) return '';

  try {
    return truncate(JSON.stringify(value));
  } catch {
    return '[unserialisable]';
  }
}
