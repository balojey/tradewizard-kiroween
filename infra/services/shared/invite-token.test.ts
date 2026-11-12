import { describe, expect, it } from 'vitest';
import {
  generateInviteToken,
  hashInviteToken,
  inviteLinkStatus,
  looksLikeInviteToken,
} from './invite-token';

describe('invite tokens', () => {
  it('generates URL-safe tokens of the expected entropy', () => {
    const token = generateInviteToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(looksLikeInviteToken(token)).toBe(true);
  });

  it('does not repeat tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateInviteToken()));
    expect(tokens.size).toBe(200);
  });

  it('hashes deterministically without storing the token', () => {
    const token = generateInviteToken();
    const hash = hashInviteToken(token);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashInviteToken(token));
    expect(hash).not.toContain(token);
    expect(hash).not.toBe(hashInviteToken(generateInviteToken()));
  });

  it('rejects obviously malformed tokens before a database lookup', () => {
    expect(looksLikeInviteToken('')).toBe(false);
    expect(looksLikeInviteToken('short')).toBe(false);
    expect(looksLikeInviteToken('../etc/passwd')).toBe(false);
    expect(looksLikeInviteToken('a'.repeat(200))).toBe(false);
  });
});

describe('inviteLinkStatus', () => {
  const base = {
    expiresAt: new Date(Date.now() + 60_000),
    useCount: 0,
    maxUses: 5,
    revokedAt: null as Date | null,
  };

  it('is active while unused, unrevoked and in date', () => {
    expect(inviteLinkStatus(base)).toBe('active');
  });

  it('expires at the boundary', () => {
    expect(inviteLinkStatus({ ...base, expiresAt: new Date(Date.now() - 1) })).toBe('expired');
  });

  it('is exhausted when every use is taken', () => {
    expect(inviteLinkStatus({ ...base, useCount: 5 })).toBe('exhausted');
  });

  it('reports revoked ahead of expired or exhausted', () => {
    expect(
      inviteLinkStatus({
        ...base,
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() - 1),
        useCount: 5,
      })
    ).toBe('revoked');
  });

  it('accepts ISO strings (as returned by JSON)', () => {
    expect(inviteLinkStatus({ ...base, expiresAt: new Date(Date.now() + 1_000).toISOString() })).toBe(
      'active'
    );
  });
});
