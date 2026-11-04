/**
 * Thread access tokens for support tickets.
 *
 * Shared because two services mint them: the public API (intake) and the admin
 * API (each reply rotates the link so the newest email always works). Only the
 * SHA-256 hash is ever stored; the raw token exists in the email and nowhere else.
 */

import { createHash, randomBytes } from 'node:crypto';

export const ACCESS_TOKEN_TTL_DAYS = 30;

export function generateAccessToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function accessTokenExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + ACCESS_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
