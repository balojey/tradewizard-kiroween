import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

const { queries, secretMock } = vi.hoisted(() => ({
  queries: {
    markDeliveryByProviderId: vi.fn(),
    suppressEmail: vi.fn(),
  },
  secretMock: { send: vi.fn() },
}));

vi.mock('./lib/db', () => ({ withClient: (fn: (client: unknown) => unknown) => fn({}) }));
vi.mock('./lib/queries', () => queries);
vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: vi.fn(() => ({ send: secretMock.send })),
  GetSecretValueCommand: vi.fn((input: unknown) => ({ input })),
}));

import { handleResendWebhook } from './webhook';
import { HttpError } from './lib/http';

const SECRET = `whsec_${Buffer.from('webhook-test-key').toString('base64')}`;

function signed(body: string, id = 'msg_1', timestamp = String(Math.floor(Date.now() / 1000))) {
  const key = Buffer.from(SECRET.replace('whsec_', ''), 'base64');
  const signature = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64');

  return {
    body,
    headers: {
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': `v1,${signature}`,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_WEBHOOK_SECRET_ARN = 'arn:secret';
  secretMock.send.mockResolvedValue({ SecretString: SECRET });
  queries.markDeliveryByProviderId.mockResolvedValue(1);
  queries.suppressEmail.mockResolvedValue(undefined);
});

describe('resend webhook', () => {
  it('rejects an unsigned request before touching the database', async () => {
    const body = JSON.stringify({ type: 'email.bounced', data: { email_id: 'e1', to: ['a@b.c'] } });

    await expect(
      handleResendWebhook({ body, headers: { 'svix-id': 'x' } })
    ).rejects.toBeInstanceOf(HttpError);

    expect(queries.suppressEmail).not.toHaveBeenCalled();
  });

  it('suppresses a permanent bounce', async () => {
    const body = JSON.stringify({
      type: 'email.bounced',
      data: { email_id: 'e1', to: ['gone@example.com'], bounce: { type: 'Permanent' } },
    });

    const response = await handleResendWebhook(signed(body));

    expect(response.statusCode).toBe(200);
    expect(queries.markDeliveryByProviderId).toHaveBeenCalledWith(
      expect.anything(),
      'e1',
      'bounced',
      expect.any(String)
    );
    expect(queries.suppressEmail).toHaveBeenCalledWith(
      expect.anything(),
      'gone@example.com',
      'bounced',
      'e1'
    );
  });

  it('marks a transient bounce without suppressing the address', async () => {
    const body = JSON.stringify({
      type: 'email.bounced',
      data: { email_id: 'e1', to: ['maybe@example.com'], bounce: { type: 'Transient' } },
    });

    await handleResendWebhook(signed(body));

    expect(queries.markDeliveryByProviderId).toHaveBeenCalled();
    expect(queries.suppressEmail).not.toHaveBeenCalled();
  });

  it('suppresses a complaint permanently', async () => {
    const body = JSON.stringify({
      type: 'email.complained',
      data: { email_id: 'e2', to: ['angry@example.com'] },
    });

    const response = await handleResendWebhook(signed(body));

    expect(response.statusCode).toBe(200);
    expect(queries.suppressEmail).toHaveBeenCalledWith(
      expect.anything(),
      'angry@example.com',
      'complained',
      'e2'
    );
  });

  it('acknowledges and ignores events we do not act on', async () => {
    const body = JSON.stringify({ type: 'email.opened', data: { email_id: 'e3' } });

    const response = await handleResendWebhook(signed(body));

    expect(response.statusCode).toBe(200);
    expect(queries.suppressEmail).not.toHaveBeenCalled();
    expect(queries.markDeliveryByProviderId).not.toHaveBeenCalled();
  });
});
