import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from './lib/http';
import { hashToken } from './lib/tokens';

const { queries, authMock, settingsMock, dbMock, limitsMock, notifyMock, supportTicketsMock } = vi.hoisted(() => ({
  queries: {
    insertTicket: vi.fn(),
    insertMessage: vi.fn(),
    findTicketByRequestId: vi.fn(),
    findRecentDuplicate: vi.fn(),
    getTicketByRef: vi.fn(),
    getTicketById: vi.fn(),
    listMessages: vi.fn(),
    findMessageByRequestId: vi.fn(),
    touchTicket: vi.fn(),
    markConfirmationSent: vi.fn(),
    findUserIdByEmail: vi.fn(),
    listTicketsForUser: vi.fn(),
  },
  authMock: {
    readBearerIdentity: vi.fn(),
    authorizerSub: vi.fn(),
  },
  settingsMock: {
    warmSettings: vi.fn(),
    getSettingSync: vi.fn(),
  },
  dbMock: {
    getUserIdByCognitoSub: vi.fn(),
  },
  limitsMock: {
    enforceSubmitLimits: vi.fn(),
    enforceMessageLimit: vi.fn(),
  },
  notifyMock: {
    sendSupportAcknowledgement: vi.fn(),
  },
  supportTicketsMock: {
    hasValidThreadToken: vi.fn(),
    issueThreadToken: vi.fn(),
  },
}));

vi.mock('./lib/queries', () => queries);
vi.mock('./lib/db', () => ({ withClient: (fn: (client: unknown) => unknown) => fn({}) }));
vi.mock('./lib/auth', () => authMock);
vi.mock('./lib/limits', () => limitsMock);
vi.mock('../shared/support-email', () => notifyMock);
vi.mock('../shared/support-tickets', () => supportTicketsMock);
vi.mock('../shared/settings', () => settingsMock);
vi.mock('../shared/db', () => dbMock);

import { handler } from './handler';

const THREAD_TOKEN = 'good-token-0123456789';

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    ref: 'TW-4F2K9Q',
    requester_email: 'person@example.com',
    user_id: null,
    topic: 'analysis',
    status: 'open',
    priority: 'normal',
    subject: 'Wrong recommendation',
    body: 'The analysis recommends BUY YES but the market resolved NO.',
    context: { marketId: 'm1' },
    context_hash: 'hash',
    assigned_admin_sub: null,
    confirmation_sent: false,
    access_token_hash: hashToken(THREAD_TOKEN),
    access_token_expires_at: new Date(Date.now() + 86_400_000),
    last_message_at: new Date(),
    resolved_at: null,
    closed_at: null,
    created_at: new Date(),
    ...overrides,
  };
}

const message = {
  id: 'msg-1',
  author_type: 'customer' as const,
  author_user_id: null,
  author_admin_sub: null,
  author_admin_email: null,
  body: 'hello',
  is_internal: false,
  created_at: new Date(),
};

function event(overrides: Record<string, unknown> = {}) {
  return {
    httpMethod: 'POST',
    path: '/support/tickets',
    headers: {},
    body: JSON.stringify({
      email: 'person@example.com',
      topic: 'analysis',
      subject: 'Wrong recommendation',
      body: 'The analysis recommends BUY YES but the market resolved NO.',
      context: { marketId: 'm1', page: '/markets/x' },
      requestId: 'req-123456',
    }),
    queryStringParameters: null,
    requestContext: { identity: { sourceIp: '203.0.113.9' } },
    ...overrides,
  } as Parameters<typeof handler>[0];
}

function body(response: { body: string }) {
  return JSON.parse(response.body);
}

beforeEach(() => {
  vi.clearAllMocks();

  settingsMock.warmSettings.mockResolvedValue(undefined);
  settingsMock.getSettingSync.mockReturnValue(true);
  limitsMock.enforceSubmitLimits.mockResolvedValue(undefined);
  limitsMock.enforceMessageLimit.mockResolvedValue(undefined);
  notifyMock.sendSupportAcknowledgement.mockResolvedValue({ provider: 'resend' });
  supportTicketsMock.hasValidThreadToken.mockImplementation(
    async (_client: unknown, _ticketId: string, token: string) => token === THREAD_TOKEN
  );
  dbMock.getUserIdByCognitoSub.mockResolvedValue(null);

  queries.insertTicket.mockResolvedValue({
    id: 'ticket-1',
    ref: 'TW-4F2K9Q',
    accessToken: THREAD_TOKEN,
  });
  queries.findTicketByRequestId.mockResolvedValue(null);
  queries.findRecentDuplicate.mockResolvedValue(null);
  queries.findUserIdByEmail.mockResolvedValue(null);
  queries.markConfirmationSent.mockResolvedValue(undefined);
  queries.getTicketByRef.mockResolvedValue(ticket());
  queries.listMessages.mockResolvedValue([message]);
  queries.insertMessage.mockResolvedValue(message);
  queries.touchTicket.mockResolvedValue(undefined);
  supportTicketsMock.issueThreadToken.mockResolvedValue(THREAD_TOKEN);
});

describe('POST /support/tickets', () => {
  it('creates a ticket for an anonymous requester', async () => {
    const response = await handler(event());

    expect(response.statusCode).toBe(201);
    expect(body(response)).toMatchObject({ ref: 'TW-4F2K9Q', emailSent: true });

    const [, inserted] = queries.insertTicket.mock.calls[0];
    expect(inserted.userId).toBeNull();
    expect(inserted.contextHash).toHaveLength(64);
    expect(inserted.context).not.toHaveProperty('attacker');
    expect(notifyMock.sendSupportAcknowledgement).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'person@example.com', ref: 'TW-4F2K9Q', token: THREAD_TOKEN })
    );
    expect(queries.markConfirmationSent).toHaveBeenCalledWith(expect.anything(), 'ticket-1');
  });

  it('links an existing account silently, without saying so', async () => {
    queries.findUserIdByEmail.mockResolvedValue('user-1');

    const linked = await handler(event());
    queries.findUserIdByEmail.mockResolvedValue(null);
    const anonymous = await handler(event());

    expect(queries.insertTicket.mock.calls[0][1].userId).toBe('user-1');
    expect(queries.insertTicket.mock.calls[1][1].userId).toBeNull();
    // Identical response: the endpoint cannot be used to test whether an email
    // has an account.
    expect(linked.statusCode).toBe(anonymous.statusCode);
    expect(body(linked)).toEqual(body(anonymous));
  });

  it('uses the verified account email instead of the posted one', async () => {
    authMock.readBearerIdentity.mockResolvedValue({ sub: 'sub-1', email: 'Account@Example.com' });
    dbMock.getUserIdByCognitoSub.mockResolvedValue('user-1');

    const response = await handler(
      event({
        headers: { Authorization: 'Bearer id-token' },
        body: JSON.stringify({
          email: 'typo@example.com',
          topic: 'analysis',
          subject: 'Signed in but typed the wrong address',
          body: 'The form should not have asked me for an email while signed in.',
          context: { marketId: 'm1' },
        }),
      })
    );

    expect(response.statusCode).toBe(201);
    const [, inserted] = queries.insertTicket.mock.calls[0];
    expect(inserted.email).toBe('account@example.com');
    expect(inserted.userId).toBe('user-1');
    expect(notifyMock.sendSupportAcknowledgement).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'account@example.com' })
    );
  });

  it('returns the original ref for a replayed requestId', async () => {
    queries.findTicketByRequestId.mockResolvedValue(ticket({ confirmation_sent: true }));

    const response = await handler(event());

    expect(response.statusCode).toBe(200);
    expect(body(response)).toMatchObject({ ref: 'TW-4F2K9Q', duplicate: true });
    expect(queries.insertTicket).not.toHaveBeenCalled();
  });

  it('returns the open ticket for the same context inside the window', async () => {
    queries.findRecentDuplicate.mockResolvedValue(ticket({ confirmation_sent: true }));

    const response = await handler(event({ body: JSON.stringify({
      email: 'person@example.com',
      topic: 'analysis',
      subject: 'Same issue again',
      body: 'Reloading the page lost my first request, so I am asking again.',
      context: { marketId: 'm1' },
    }) }));

    expect(response.statusCode).toBe(200);
    expect(body(response)).toMatchObject({ duplicate: true, ref: 'TW-4F2K9Q' });
    expect(queries.insertTicket).not.toHaveBeenCalled();
  });

  it('resends the acknowledgement when the original never went out', async () => {
    queries.findTicketByRequestId.mockResolvedValue(ticket({ confirmation_sent: false }));

    const response = await handler(event());

    expect(response.statusCode).toBe(200);
    expect(supportTicketsMock.issueThreadToken).toHaveBeenCalledWith(expect.anything(), 'ticket-1');
    expect(notifyMock.sendSupportAcknowledgement).toHaveBeenCalled();
  });

  it('rejects invalid input before touching limits or the database', async () => {
    const response = await handler(
      event({ body: JSON.stringify({ email: 'nope', topic: 'analysis', subject: 'x', body: 'y' }) })
    );

    expect(response.statusCode).toBe(422);
    expect(body(response).error.code).toBe('VALIDATION_ERROR');
    expect(limitsMock.enforceSubmitLimits).not.toHaveBeenCalled();
    expect(queries.insertTicket).not.toHaveBeenCalled();
  });

  it('is closed by the support_enabled setting', async () => {
    settingsMock.getSettingSync.mockReturnValue(false);

    const response = await handler(event());

    expect(response.statusCode).toBe(503);
    expect(body(response).error.code).toBe('SUPPORT_DISABLED');
    expect(queries.insertTicket).not.toHaveBeenCalled();
  });

  it('reports rate limiting as 429', async () => {
    limitsMock.enforceSubmitLimits.mockRejectedValue(
      new HttpError(429, 'RATE_LIMITED', 'slow down', { retryAfterSeconds: 3600 })
    );

    const response = await handler(event());

    expect(response.statusCode).toBe(429);
    expect(body(response).error).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 3600 });
  });

  it('keeps the ticket when the acknowledgement cannot be sent', async () => {
    notifyMock.sendSupportAcknowledgement.mockRejectedValue(new Error('resend down'));

    const response = await handler(event());

    expect(response.statusCode).toBe(502);
    expect(body(response).error).toMatchObject({ code: 'EMAIL_FAILED', ref: 'TW-4F2K9Q' });
    expect(queries.insertTicket).toHaveBeenCalled();
    expect(queries.markConfirmationSent).not.toHaveBeenCalled();
  });
});

describe('GET /support/tickets/{ref}', () => {
  it('returns the thread for a valid token', async () => {
    const response = await handler(
      event({ httpMethod: 'GET', path: '/support/tickets/TW-4F2K9Q', body: null, queryStringParameters: { t: THREAD_TOKEN } })
    );

    expect(response.statusCode).toBe(200);
    expect(body(response).ticket).toMatchObject({ ref: 'TW-4F2K9Q' });
    expect(body(response).canReply).toBe(true);
    expect(body(response).messages).toEqual([
      expect.objectContaining({ author: 'customer', body: 'hello' }),
    ]);
  });

  it('treats a wrong token as not found', async () => {
    const response = await handler(
      event({ httpMethod: 'GET', path: '/support/tickets/TW-4F2K9Q', body: null, queryStringParameters: { t: 'wrong' } })
    );

    expect(response.statusCode).toBe(404);
    expect(queries.listMessages).not.toHaveBeenCalled();
  });

  it('treats an expired token as not found', async () => {
    supportTicketsMock.hasValidThreadToken.mockResolvedValue(false);

    const response = await handler(
      event({ httpMethod: 'GET', path: '/support/tickets/TW-4F2K9Q', body: null, queryStringParameters: { t: THREAD_TOKEN } })
    );

    expect(response.statusCode).toBe(404);
  });

  it('allows a signed-in owner without a token', async () => {
    queries.getTicketByRef.mockResolvedValue(ticket({ user_id: 'user-1' }));
    authMock.readBearerIdentity.mockResolvedValue({ sub: 'sub-1' });
    dbMock.getUserIdByCognitoSub.mockResolvedValue('user-1');

    const response = await handler(
      event({
        httpMethod: 'GET',
        path: '/support/tickets/TW-4F2K9Q',
        body: null,
        headers: { Authorization: 'Bearer id-token' },
      })
    );

    expect(response.statusCode).toBe(200);
  });

  it('refuses someone else with a valid token for a different account', async () => {
    queries.getTicketByRef.mockResolvedValue(ticket({ user_id: 'user-1' }));
    authMock.readBearerIdentity.mockResolvedValue({ sub: 'sub-2' });
    dbMock.getUserIdByCognitoSub.mockResolvedValue('user-2');

    const response = await handler(
      event({ httpMethod: 'GET', path: '/support/tickets/TW-4F2K9Q', body: null, headers: { Authorization: 'Bearer other' } })
    );

    expect(response.statusCode).toBe(404);
  });
});

describe('POST /support/tickets/{ref}/messages', () => {
  it('appends a customer reply and reopens a pending ticket', async () => {
    queries.getTicketByRef.mockResolvedValue(ticket({ status: 'pending' }));

    const response = await handler(
      event({
        path: '/support/tickets/TW-4F2K9Q/messages',
        body: JSON.stringify({ body: 'Adding the analysis link now.' }),
        queryStringParameters: { t: THREAD_TOKEN },
      })
    );

    expect(response.statusCode).toBe(201);
    expect(queries.insertMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ticketId: 'ticket-1', authorType: 'customer' })
    );
    expect(queries.touchTicket).toHaveBeenCalledWith(expect.anything(), 'ticket-1', true);
  });

  it('refuses a reply to a closed ticket', async () => {
    queries.getTicketByRef.mockResolvedValue(ticket({ status: 'closed' }));

    const response = await handler(
      event({
        path: '/support/tickets/TW-4F2K9Q/messages',
        body: JSON.stringify({ body: 'One more question please.' }),
        queryStringParameters: { t: THREAD_TOKEN },
      })
    );

    expect(response.statusCode).toBe(409);
    expect(body(response).error.code).toBe('TICKET_CLOSED');
  });

  it('does not double-post a replayed message', async () => {
    queries.findMessageByRequestId.mockResolvedValue(message);

    const response = await handler(
      event({
        path: '/support/tickets/TW-4F2K9Q/messages',
        body: JSON.stringify({ body: 'Adding the analysis link now.', requestId: 'msg-req-123' }),
        queryStringParameters: { t: THREAD_TOKEN },
      })
    );

    expect(response.statusCode).toBe(200);
    expect(queries.insertMessage).not.toHaveBeenCalled();
  });
});

describe('GET /support/tickets', () => {
  it('lists the signed-in requester’s tickets', async () => {
    authMock.authorizerSub.mockReturnValue('sub-1');
    dbMock.getUserIdByCognitoSub.mockResolvedValue('user-1');
    queries.listTicketsForUser.mockResolvedValue([
      { ref: 'TW-4F2K9Q', subject: 'Wrong recommendation', topic: 'analysis', status: 'open', last_message_at: new Date(), created_at: new Date() },
    ]);

    const response = await handler(
      event({ httpMethod: 'GET', path: '/support/tickets', body: null })
    );

    expect(response.statusCode).toBe(200);
    expect(body(response).items).toHaveLength(1);
    expect(queries.listTicketsForUser).toHaveBeenCalledWith(expect.anything(), 'user-1');
  });

  it('refuses an unauthenticated list request', async () => {
    authMock.authorizerSub.mockReturnValue(null);

    const response = await handler(
      event({ httpMethod: 'GET', path: '/support/tickets', body: null })
    );

    expect(response.statusCode).toBe(401);
  });
});

describe('routing', () => {
  it('answers CORS preflight without touching anything', async () => {
    const response = await handler(event({ httpMethod: 'OPTIONS', path: '/support/tickets', body: null }));

    expect(response.statusCode).toBe(204);
    expect(response.headers['Access-Control-Allow-Origin']).toBe('*');
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const response = await handler(event({ httpMethod: 'GET', path: '/support/nope', body: null }));

    expect(response.statusCode).toBe(404);
    expect(body(response).error.code).toBe('NOT_FOUND');
  });
});
