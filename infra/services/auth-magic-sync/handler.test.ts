import { describe, expect, it } from 'vitest';
import { handler } from './handler';

function event(body: string) {
  return {
    body,
    httpMethod: 'POST',
    path: '/auth/magic-sync',
    headers: { 'Content-Type': 'application/json' },
  };
}

describe('magic-sync email policy', () => {
  it('rejects a Warden-aliased address before touching Cognito', async () => {
    const response = await handler(event(JSON.stringify({ email: 'azeez+warden@gmail.com' })));

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({ code: 'PLUS_TAG_NOT_SUPPORTED' });
  });

  it('rejects any plus tag, not just the Warden one', async () => {
    const response = await handler(event(JSON.stringify({ email: 'person+anything@example.com' })));

    expect(response.statusCode).toBe(400);
  });

  it('still rejects a request with no email', async () => {
    const response = await handler(event(JSON.stringify({})));

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({ error: 'Valid email is required' });
  });

  it('rejects a body that is not JSON', async () => {
    const response = await handler(event('not json'));

    // Parsing throws before the policy check; the handler reports a generic 500
    // today. What matters is that it never proceeds to create a user.
    expect(response.statusCode).toBe(500);
  });
});
