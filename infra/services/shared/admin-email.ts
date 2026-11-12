/**
 * Warden (admin) email aliasing.
 *
 * Every admin account is created on a dedicated Cognito identity, never on the
 * customer's address. The product signs in with a magic link whose password is
 * derived from the email (`HMAC(PASSWORD_SALT, email)`), and setting a portal
 * password or enrolling TOTP on that same account breaks the magic-link path
 * (docs/admin-portal-architecture.md §6.1, incident 2026-11-03).
 *
 * Aliasing removes the collision structurally: `john@gmail.com` gets
 * `john+warden@gmail.com` as its admin identity, which still delivers to the same
 * inbox on providers that support plus addressing (Gmail, Outlook, Fastmail,
 * Proton, Yahoo — some corporate servers do not; see the join page copy, which
 * always shows the exact address before an account is created).
 *
 * This is the single implementation. The manual Add-member dialog and the public
 * join endpoint both call it, so the two paths cannot drift.
 */

/** Tag appended to the local part. Matched case-insensitively. */
const WARDEN_TAG = '+warden';

/** RFC 5321 limit for the whole address. */
const MAX_EMAIL_LENGTH = 254;

export class AdminEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminEmailError';
  }
}

export interface AdminEmailResult {
  /** Address as supplied, trimmed. */
  original: string;
  /** Address to create the admin identity on. */
  adminEmail: string;
  /** False when the input already carried the `+warden` tag. */
  changed: boolean;
}

/**
 * Normalise an operator-supplied address into a dedicated admin address.
 *
 * Rules (docs/warden-invite-links-plan.md §3):
 * 1. trim, lowercase the whole address;
 * 2. split on the LAST `@`;
 * 3. leave an already-aliased local part alone (idempotent);
 * 4. otherwise append `+warden` to the local part **as typed** — we never strip
 *    an existing tag, because on some servers a plus-tag is meaningful routing
 *    and stripping it would silently redirect the person's mail.
 *
 * The checks here are deliberately structural, not exhaustive: Cognito performs
 * the authoritative validation when the user is created.
 */
export function toAdminEmail(raw: unknown): AdminEmailResult {
  if (typeof raw !== 'string') {
    throw new AdminEmailError('Enter an email address');
  }

  const original = raw.trim();
  if (!original) {
    throw new AdminEmailError('Enter an email address');
  }

  if (/\s/.test(original)) {
    throw new AdminEmailError('Enter a valid email address');
  }

  const at = original.lastIndexOf('@');
  if (at <= 0 || at === original.length - 1) {
    throw new AdminEmailError('Enter a valid email address');
  }

  const rawLocal = original.slice(0, at);
  const rawDomain = original.slice(at + 1);

  if (
    rawLocal.startsWith('.') ||
    rawLocal.endsWith('.') ||
    rawLocal.includes('..') ||
    rawDomain.startsWith('.') ||
    rawDomain.endsWith('.') ||
    rawDomain.includes('..') ||
    !rawDomain.includes('.')
  ) {
    throw new AdminEmailError('Enter a valid email address');
  }

  const local = rawLocal.toLowerCase();
  const domain = rawDomain.toLowerCase();

  const alreadyAliased = local.endsWith(WARDEN_TAG);
  const adminEmail = alreadyAliased ? `${local}@${domain}` : `${local}${WARDEN_TAG}@${domain}`;

  if (adminEmail.length > MAX_EMAIL_LENGTH) {
    throw new AdminEmailError('That email address is too long to use for a Warden account');
  }

  return {
    original,
    adminEmail,
    changed: !alreadyAliased,
  };
}

/** True when an address already carries the admin tag (case-insensitive). */
export function isAdminAlias(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at <= 0) return false;
  return email.slice(0, at).toLowerCase().endsWith(WARDEN_TAG);
}
