import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queries, settingsMock, tokenMock, dynamoMock } = vi.hoisted(() => ({
  queries: {
    getPortalUser: vi.fn(),
    getSubscription: vi.fn(),
    upsertSubscription: vi.fn(),
    markPrompted: vi.fn(),
  },
  settingsMock: {
    warmSettings: vi.fn(),
    getSettingSync: vi.fn(),
  },
  tokenMock: {
    readUnsubscribeToken: vi.fn(),
    hashConsentIp: vi.fn(),
  },
  dynamoMock: {
    incrementCounter: vi.fn(),
  },
}));

vi.mock('./lib/db', () => ({ withClient: (fn: (client: unknown) => unknown) => fn({}) }));
vi.mock('./lib/queries', () => queries);
vi.mock('../shared/settings', () => settingsMock);
vi.mock('../shared/newsletter-token', () => tokenMock);
vi.mock('../shared/dynamo', () => dynamoMock);

import { handler } from './handler';

function event(overrides: Record<string, unknown> = {}) {
  return {
    httpMethod: 'GET',
    path: '/user/newsletter',
    headers: {},
    body: null,
    queryStringParameters: null,
    requestContext: {
      authorizer: { claims: { sub: 'sub-1', email: 'person@example.com' } },
      identity: { sourceIp: '203.0.113.9' },
    },
    ...overrides,
  } as Parameters<typeof handler>[0];
}

function body(response: { body: string }) {
  return JSON.parse(response.body);
}

beforeEach(() => {
  vi.clearAllMocks();

  queries.getPortalUser.mockResolvedValue({
    id: 'user-1',
    email: 'person@example.com',
    newsletterPromptedAt: null,
  });
  queries.getSubscription.mockResolvedValue(null);
  queries.upsertSubscription.mockResolvedValue({
    status: 'subscribed',
    source: 'account_toggle',
    confirmedAt: '2026-11-04T00:00:00.000Z',
    unsubscribedAt: null,
  });
  queries.markPrompted.mockResolvedValue(undefined);

  settingsMock.warmSettings.mockResolvedValue(undefined);
  settingsMock.getSettingSync.mockReturnValue(true);
  tokenMock.readUnsubscribeToken.mockResolvedValue('person@example.com');
  tokenMock.hashConsentIp.mockResolvedValue('ip-hash');
  dynamoMock.incrementCounter.mockResolvedValue(1);
});

describe('account consent', () => {
  it('reports "none" before the customer answers', async () => {
    const response = await handler(event());

    expect(response.statusCode).toBe(200);
    expect(body(response)).toMatchObject({ status: 'none', promptedAt: null });
  });

  it('reports an existing subscription', async () => {
    queries.getSubscription.mockResolvedValue({
      status: 'subscribed',
      source: 'signup_prompt',
      confirmedAt: '2026-11-04T00:00:00.000Z',
      unsubscribedAt: null,
    });

    const response = await handler(event());

    expect(body(response).status).toBe('subscribed');
  });

  it('records explicit consent with version and a hashed IP', async () => {
    const response = await handler(
      event({
        httpMethod: 'POST',
        body: JSON.stringify({ optIn: true, source: 'signup_prompt' }),
      })
    );

    expect(response.statusCode).toBe(200);
    expect(queries.upsertSubscription).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        email: 'person@example.com',
        subscribed: true,
        source: 'signup_prompt',
        consentVersion: '2026-11-04',
        ipHash: 'ip-hash',
      })
    );
    expect(queries.markPrompted).toHaveBeenCalledWith(expect.anything(), 'user-1');
  });

  it('refuses new opt-ins when the newsletter is disabled', async () => {
    settingsMock.getSettingSync.mockReturnValue(false);

    const response = await handler(
      event({ httpMethod: 'POST', body: JSON.stringify({ optIn: true }) })
    );

    expect(response.statusCode).toBe(409);
    expect(queries.upsertSubscription).not.toHaveBeenCalled();
  });

  it('marks the prompt answered without creating a subscription', async () => {
    const response = await handler(
      event({ httpMethod: 'POST', path: '/user/newsletter/dismiss' })
    );

    expect(response.statusCode).toBe(200);
    expect(queries.markPrompted).toHaveBeenCalled();
    expect(queries.upsertSubscription).not.toHaveBeenCalled();
  });

  it('requires an authenticated caller', async () => {
    const response = await handler(event({ requestContext: {} }));

    expect(response.statusCode).toBe(401);
  });
});

describe('unsubscribe', () => {
  it('validates a link without mutating anything', async () => {
    const response = await handler(
      event({ path: '/newsletter/unsubscribe', queryStringParameters: { token: 'abc' } })
    );

    expect(response.statusCode).toBe(200);
    expect(queries.upsertSubscription).not.toHaveBeenCalled();
  });

  it('rejects a tampered or expired link', async () => {
    tokenMock.readUnsubscribeToken.mockResolvedValue(null);

    const response = await handler(
      event({ path: '/newsletter/unsubscribe', queryStringParameters: { token: 'bad' } })
    );

    expect(response.statusCode).toBe(400);
    expect(queries.upsertSubscription).not.toHaveBeenCalled();
  });

  it('unsubscribes by encrypted token, with no account required', async () => {
    queries.upsertSubscription.mockResolvedValue({
      status: 'unsubscribed',
      source: 'unsubscribe_link',
      confirmedAt: null,
      unsubscribedAt: '2026-11-04T00:00:00.000Z',
    });

    const response = await handler(
      event({
        httpMethod: 'POST',
        path: '/newsletter/unsubscribe',
        queryStringParameters: { token: 'token-1' },
        requestContext: {},
      })
    );

    expect(response.statusCode).toBe(200);
    expect(queries.upsertSubscription).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        email: 'person@example.com',
        subscribed: false,
        source: 'unsubscribe_link',
      })
    );
  });

  it('still works when the newsletter is disabled', async () => {
    settingsMock.getSettingSync.mockReturnValue(false);

    const response = await handler(
      event({
        httpMethod: 'POST',
        path: '/newsletter/unsubscribe',
        queryStringParameters: { token: 'token-1' },
        requestContext: {},
      })
    );

    expect(response.statusCode).toBe(200);
  });

  it('rate-limits token attempts', async () => {
    dynamoMock.incrementCounter.mockResolvedValue(31);

    const response = await handler(
      event({ path: '/newsletter/unsubscribe', queryStringParameters: { token: 'abc' } })
    );

    expect(response.statusCode).toBe(429);
  });
});
