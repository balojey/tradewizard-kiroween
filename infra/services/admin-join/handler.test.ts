import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  withClientMock,
  auditMock,
  emailMock,
  cognitoMock,
  inviteLinksMock,
  dynamoMock,
} = vi.hoisted(() => ({
  withClientMock: vi.fn(),
  auditMock: {
    writeSystemAuditLog: vi.fn(),
    completeAudit: vi.fn(),
  },
  emailMock: {
    sendEmail: vi.fn(),
  },
  cognitoMock: {
    findUserByEmail: vi.fn(),
    createInvitedAdmin: vi.fn(),
    addToGroup: vi.fn(),
  },
  inviteLinksMock: {
    findInviteLinkByTokenHash: vi.fn(),
    reserveInviteUse: vi.fn(),
    releaseInviteUse: vi.fn(),
    recordInviteRedemption: vi.fn(),
  },
  dynamoMock: {
    incrementCounter: vi.fn(),
  },
}));

vi.mock('../admin-api/lib/db', () => ({ withClient: withClientMock }));
vi.mock('../admin-api/lib/audit', () => auditMock);
vi.mock('../shared/email', () => emailMock);
vi.mock('./lib/cognito', () => cognitoMock);
vi.mock('../shared/invite-links', () => inviteLinksMock);
vi.mock('../shared/dynamo', () => dynamoMock);

import { generateInviteToken, hashInviteToken } from '../shared/invite-token';
import { handler } from './handler';
import type { AdminApiEvent, ApiResponse } from '../admin-api/lib/types';

const TOKEN = 'a'.repeat(43);
const LINK_ID = '3f1d2c9a-1111-4222-8333-944455556666';

function link(overrides: Record<string, unknown> = {}) {
  return {
    id: LINK_ID,
    role: 'analyst' as const,
    createdBySub: 'owner-sub',
    createdByEmail: 'owner@example.com',
    reason: 'sharing with the research team',
    expiresAt: new Date(Date.now() + 3_600_000),
    maxUses: 5,
    useCount: 1,
    revokedAt: null,
    revokedBy: null,
    lastUsedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeEvent(
  overrides: Omit<Partial<AdminApiEvent>, 'body'> & { body?: unknown } = {}
): AdminApiEvent {
  const { body, ...rest } = overrides;

  return {
    httpMethod: 'POST',
    path: '/join/lookup',
    headers: { origin: 'https://warden.tradewizard.live' },
    body: body === undefined ? JSON.stringify({ token: TOKEN }) : JSON.stringify(body),
    requestContext: {
      requestId: 'req-join-1',
      identity: { sourceIp: '203.0.113.7' },
    },
    ...rest,
  };
}

function body(response: ApiResponse): Record<string, unknown> {
  return JSON.parse(response.body);
}

beforeEach(() => {
  process.env.ADMIN_ALLOWED_ORIGINS = 'https://warden.tradewizard.live';
  process.env.ADMIN_APP_URL = 'https://warden.tradewizard.live';
  process.env.RESEND_FROM_EMAIL = 'support@tradewizard.live';

  withClientMock.mockReset();
  withClientMock.mockImplementation((fn: (client: unknown) => Promise<unknown>) =>
    fn({ query: vi.fn() })
  );

  auditMock.writeSystemAuditLog.mockReset();
  auditMock.writeSystemAuditLog.mockResolvedValue('audit-1');
  auditMock.completeAudit.mockReset();
  auditMock.completeAudit.mockResolvedValue(undefined);

  emailMock.sendEmail.mockReset();
  emailMock.sendEmail.mockResolvedValue({ provider: 'resend', messageId: 'msg-1' });

  cognitoMock.findUserByEmail.mockReset();
  cognitoMock.findUserByEmail.mockResolvedValue(null);
  cognitoMock.createInvitedAdmin.mockReset();
  cognitoMock.createInvitedAdmin.mockResolvedValue({
    sub: 'new-admin-sub',
    status: 'FORCE_CHANGE_PASSWORD',
  });
  cognitoMock.addToGroup.mockReset();
  cognitoMock.addToGroup.mockResolvedValue(undefined);

  inviteLinksMock.findInviteLinkByTokenHash.mockReset();
  inviteLinksMock.findInviteLinkByTokenHash.mockResolvedValue(link());
  inviteLinksMock.reserveInviteUse.mockReset();
  inviteLinksMock.reserveInviteUse.mockResolvedValue(link({ useCount: 2 }));
  inviteLinksMock.releaseInviteUse.mockReset();
  inviteLinksMock.releaseInviteUse.mockResolvedValue(undefined);
  inviteLinksMock.recordInviteRedemption.mockReset();
  inviteLinksMock.recordInviteRedemption.mockResolvedValue(undefined);

  dynamoMock.incrementCounter.mockReset();
  dynamoMock.incrementCounter.mockResolvedValue(1);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /join/lookup', () => {
  it('returns the role and link state for a valid token', async () => {
    const response = await handler(makeEvent());

    expect(response.statusCode).toBe(200);
    expect(body(response).data).toMatchObject({
      status: 'active',
      role: 'analyst',
      remainingUses: 4,
    });
  });

  it('hashes the token before the lookup', async () => {
    await handler(makeEvent());

    expect(inviteLinksMock.findInviteLinkByTokenHash).toHaveBeenCalledWith(
      expect.anything(),
      hashInviteToken(TOKEN)
    );
  });

  it('reports revoked links as a state, not an error', async () => {
    inviteLinksMock.findInviteLinkByTokenHash.mockResolvedValue(
      link({ revokedAt: new Date() })
    );

    const response = await handler(makeEvent());

    expect(response.statusCode).toBe(200);
    expect(body(response).data).toMatchObject({ status: 'revoked' });
  });

  it('404s an unknown but well-formed token', async () => {
    inviteLinksMock.findInviteLinkByTokenHash.mockResolvedValue(null);

    const response = await handler(makeEvent());

    expect(response.statusCode).toBe(404);
    expect(body(response).error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a malformed token without touching the database', async () => {
    const response = await handler(makeEvent({ body: { token: 'short' } }));

    expect(response.statusCode).toBe(404);
    expect(inviteLinksMock.findInviteLinkByTokenHash).not.toHaveBeenCalled();
  });

  it('rate limits repeated lookups', async () => {
    dynamoMock.incrementCounter.mockResolvedValue(999);

    const response = await handler(makeEvent());

    expect(response.statusCode).toBe(429);
    expect(body(response).error).toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('POST /join/register', () => {
  const event = (overrides: Omit<Partial<AdminApiEvent>, 'body'> & { body?: unknown } = {}) =>
    makeEvent({
      path: '/join/register',
      body: { token: TOKEN, email: 'Azeez.Balogun74@Gmail.com' },
      ...overrides,
    });

  it('creates a dedicated admin account on the aliased address', async () => {
    const response = await handler(event());

    expect(response.statusCode).toBe(201);
    expect(body(response).data).toMatchObject({
      adminEmail: 'azeez.balogun74+warden@gmail.com',
      role: 'analyst',
      status: 'invited',
    });

    expect(cognitoMock.createInvitedAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'azeez.balogun74+warden@gmail.com' })
    );
    expect(cognitoMock.addToGroup).toHaveBeenCalledWith('new-admin-sub', 'tw-analyst');
    expect(inviteLinksMock.recordInviteRedemption).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        linkId: LINK_ID,
        cognitoSub: 'new-admin-sub',
        email: 'azeez.balogun74+warden@gmail.com',
      })
    );
    expect(emailMock.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('does not double-tag an address that already carries +warden', async () => {
    const response = await handler(
      event({ body: { token: TOKEN, email: 'person+warden@example.com' } })
    );

    expect(response.statusCode).toBe(201);
    expect(body(response).data).toMatchObject({ adminEmail: 'person+warden@example.com' });
  });

  it('emails the temporary password to the aliased address only', async () => {
    await handler(event());

    const message = emailMock.sendEmail.mock.calls[0][0] as {
      to: string;
      text: string;
      subject: string;
    };

    expect(message.to).toBe('azeez.balogun74+warden@gmail.com');
    expect(message.subject).toContain('Warden');
    expect(message.text).toContain('azeez.balogun74+warden@gmail.com');
    // The token must never appear in the email.
    expect(message.text).not.toContain(TOKEN);
    // A generated temporary password is present.
    expect(message.text).toMatch(/Temporary password: [A-Za-z0-9]{20}/);
  });

  it('audits the registration as a system action before creating anything', async () => {
    await handler(event());

    expect(auditMock.writeSystemAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorSub: `invite-link:${LINK_ID}`,
        action: 'admin.member.self_register',
        targetType: 'invite_link',
        targetId: LINK_ID,
      })
    );
    expect(auditMock.completeAudit).toHaveBeenCalledWith(
      expect.anything(),
      'audit-1',
      expect.objectContaining({ status: 'succeeded' })
    );
    // The audit payload must never carry the token or a password.
    const serialized = JSON.stringify([
      auditMock.writeSystemAuditLog.mock.calls,
      auditMock.completeAudit.mock.calls,
    ]);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toMatch(/Temporary password/i);
  });

  it('refuses an already-registered address without creating or emailing', async () => {
    cognitoMock.findUserByEmail.mockResolvedValue({
      sub: 'existing-sub',
      email: 'azeez.balogun74+warden@gmail.com',
      status: 'CONFIRMED',
    });

    const response = await handler(event());

    expect(response.statusCode).toBe(409);
    expect(cognitoMock.createInvitedAdmin).not.toHaveBeenCalled();
    expect(emailMock.sendEmail).not.toHaveBeenCalled();
    expect(inviteLinksMock.reserveInviteUse).not.toHaveBeenCalled();
  });

  it('refuses an expired link before creating an account', async () => {
    inviteLinksMock.findInviteLinkByTokenHash.mockResolvedValue(
      link({ expiresAt: new Date(Date.now() - 1) })
    );

    const response = await handler(event());

    expect(response.statusCode).toBe(409);
    expect(body(response).error).toMatchObject({ code: 'CONFLICT' });
    expect(cognitoMock.createInvitedAdmin).not.toHaveBeenCalled();
    expect(auditMock.writeSystemAuditLog).not.toHaveBeenCalled();
  });

  it('refuses a revoked link', async () => {
    inviteLinksMock.findInviteLinkByTokenHash.mockResolvedValue(
      link({ revokedAt: new Date() })
    );

    const response = await handler(event());

    expect(response.statusCode).toBe(409);
    expect((body(response).error as { details: { status: string } }).details.status).toBe(
      'revoked'
    );
  });

  it('refuses a use that loses the last-slot race and releases nothing', async () => {
    inviteLinksMock.reserveInviteUse.mockResolvedValue(null);
    inviteLinksMock.findInviteLinkByTokenHash
      .mockResolvedValueOnce(link())
      .mockResolvedValueOnce(link({ useCount: 5 }));

    const response = await handler(event());

    expect(response.statusCode).toBe(409);
    expect(cognitoMock.createInvitedAdmin).not.toHaveBeenCalled();
    expect(inviteLinksMock.releaseInviteUse).not.toHaveBeenCalled();
    expect(auditMock.completeAudit).toHaveBeenCalledWith(
      expect.anything(),
      'audit-1',
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('releases the reserved use when account creation fails', async () => {
    cognitoMock.createInvitedAdmin.mockRejectedValue(new Error('cognito unavailable'));

    const response = await handler(event());

    expect(response.statusCode).toBe(500);
    expect(inviteLinksMock.releaseInviteUse).toHaveBeenCalledWith(expect.anything(), LINK_ID);
    expect(auditMock.completeAudit).toHaveBeenCalledWith(
      expect.anything(),
      'audit-1',
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('keeps the use and reports a delivery failure when email fails twice', async () => {
    emailMock.sendEmail.mockRejectedValue(new Error('resend 500'));

    const response = await handler(event());

    expect(response.statusCode).toBe(502);
    expect(body(response).error).toMatchObject({ code: 'UPSTREAM_FAILED' });
    expect(body(response).error).toMatchObject({
      details: { accountCreated: true, emailSent: false },
    });
    // The account exists: giving the use back would allow a second account.
    expect(inviteLinksMock.releaseInviteUse).not.toHaveBeenCalled();
    expect(emailMock.sendEmail).toHaveBeenCalledTimes(2);
  });

  it('retries the invitation email once before giving up', async () => {
    emailMock.sendEmail
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({ provider: 'resend', messageId: 'msg-2' });

    const response = await handler(event());

    expect(response.statusCode).toBe(201);
    expect(emailMock.sendEmail).toHaveBeenCalledTimes(2);
  });

  it('rejects a malformed email address', async () => {
    const response = await handler(event({ body: { token: TOKEN, email: 'not-an-email' } }));

    expect(response.statusCode).toBe(400);
    expect(cognitoMock.createInvitedAdmin).not.toHaveBeenCalled();
  });

  it('rate limits registrations per IP', async () => {
    dynamoMock.incrementCounter.mockResolvedValue(999);

    const response = await handler(event());

    expect(response.statusCode).toBe(429);
    expect(cognitoMock.createInvitedAdmin).not.toHaveBeenCalled();
  });

  it('fails closed when the global counter is unavailable', async () => {
    // Per-IP and per-link calls resolve; the global call throws.
    dynamoMock.incrementCounter
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('dynamo down'));

    const response = await handler(event());

    expect(response.statusCode).toBe(503);
    expect(cognitoMock.createInvitedAdmin).not.toHaveBeenCalled();
  });

  it('handles an unknown join route with 404', async () => {
    const response = await handler(makeEvent({ path: '/join/nope' }));

    expect(response.statusCode).toBe(404);
  });

  it('generates a fresh token per link, independent of the lookup token', () => {
    // Guards against accidentally reusing the incoming token as a link token.
    expect(generateInviteToken()).not.toBe(TOKEN);
  });
});
