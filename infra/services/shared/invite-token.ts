/**
 * Invite-link token handling.
 *
 * A link is a bearer credential: whoever holds it can create one admin account
 * at the role baked into the link, until it expires, runs out of uses, or is
 * revoked (docs/warden-invite-links-plan.md §2).
 *
 * Two rules keep a database leak from turning into portal access:
 * - the token is 256 bits of CSPRNG output, so it cannot be guessed;
 * - only its SHA-256 is stored, so the table cannot reproduce a live link.
 *
 * SHA-256 (not a password hash) is correct here: the input is already uniformly
 * random, so there is no dictionary to slow down.
 */

import { createHash, randomBytes } from 'node:crypto';

/** 32 bytes → 43 base64url characters. */
export const INVITE_TOKEN_BYTES = 32;

export type InviteLinkStatus = 'active' | 'expired' | 'revoked' | 'exhausted';

export interface InviteLinkState {
  expiresAt: Date | string;
  useCount: number;
  maxUses: number;
  revokedAt?: Date | string | null;
}

export function generateInviteToken(): string {
  return randomBytes(INVITE_TOKEN_BYTES).toString('base64url');
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Cheap shape check before touching the database with a guessed token. */
export function looksLikeInviteToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{32,128}$/.test(token);
}

/**
 * Derived state. `revoked` wins over everything: an owner who revoked a link
 * needs that explanation to be the one the invitee sees, even if it has also
 * expired since.
 */
export function inviteLinkStatus(link: InviteLinkState, now: Date = new Date()): InviteLinkStatus {
  if (link.revokedAt) return 'revoked';
  if (new Date(link.expiresAt).getTime() <= now.getTime()) return 'expired';
  if (link.useCount >= link.maxUses) return 'exhausted';
  return 'active';
}
