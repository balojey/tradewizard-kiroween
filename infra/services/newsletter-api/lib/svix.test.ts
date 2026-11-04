import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifySvixSignature } from './svix';

const SECRET = `whsec_${Buffer.from('test-signing-key-material').toString('base64')}`;

function sign(id: string, timestamp: string, payload: string, secret = SECRET): string {
  const key = Buffer.from(secret.replace('whsec_', ''), 'base64');
  const digest = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${payload}`)
    .digest('base64');
  return `v1,${digest}`;
}

describe('svix signature', () => {
  const payload = JSON.stringify({ type: 'email.bounced' });
  const id = 'msg_1';
  const timestamp = String(Math.floor(Date.now() / 1000));

  it('accepts a correctly signed payload', () => {
    expect(
      verifySvixSignature(
        { id, timestamp, signature: sign(id, timestamp, payload) },
        payload,
        SECRET
      )
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(
      verifySvixSignature(
        { id, timestamp, signature: sign(id, timestamp, payload) },
        payload.replace('bounced', 'complained'),
        SECRET
      )
    ).toBe(false);
  });

  it('rejects a signature made with another secret', () => {
    const other = `whsec_${Buffer.from('someone-elses-key').toString('base64')}`;
    expect(
      verifySvixSignature(
        { id, timestamp, signature: sign(id, timestamp, payload, other) },
        payload,
        SECRET
      )
    ).toBe(false);
  });

  it('rejects a stale timestamp so a captured request cannot be replayed', () => {
    const old = String(Math.floor(Date.now() / 1000) - 10 * 60);
    expect(
      verifySvixSignature(
        { id, timestamp: old, signature: sign(id, old, payload) },
        payload,
        SECRET
      )
    ).toBe(false);
  });

  it('accepts when any of several signatures matches', () => {
    const signature = `v1,AAAA ${sign(id, timestamp, payload)}`;
    expect(
      verifySvixSignature({ id, timestamp, signature }, payload, SECRET)
    ).toBe(true);
  });

  it('rejects missing headers', () => {
    expect(verifySvixSignature({ id, timestamp, signature: undefined }, payload, SECRET)).toBe(false);
  });
});
