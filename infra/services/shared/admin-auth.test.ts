import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { verifyMock, cognitoSendMock, verifierCreateMock } = vi.hoisted(() => ({
  verifyMock: vi.fn(),
  cognitoSendMock: vi.fn(),
  verifierCreateMock: vi.fn(),
}));

vi.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: verifierCreateMock,
  },
}));

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: vi.fn(() => ({ send: cognitoSendMock })),
  AdminGetUserCommand: vi.fn((input: unknown) => ({ input })),
}));

import {
  AdminAuthError,
  ROLE_RANK,
  extractBearerToken,
  getAdminIdentity,
  groupsFromClaim,
  requireRole,
  resetAdminAuthCachesForTests,
  resolveAdminIdentity,
  roleFromGroups,
} from './admin-auth';

const ORIGINAL_ENV = { ...process.env };

function setEnv(overrides: Record<string, string | undefined> = {}): void {
  process.env = { ...ORIGINAL_ENV };
  process.env.USER_POOL_ID = 'us-east-1_TEST';
  process.env.ADMIN_CLIENT_ID = 'admin-client-id';
  process.env.ADMIN_REQUIRE_MFA = 'false';
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function tokenPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: 'sub-1',
    email: 'admin@example.com',
    token_use: 'id',
    'cognito:groups': ['tw-support'],
    ...overrides,
  };
}

function eventWithAuthorizer(context: Record<string, unknown> | undefined) {
  return { requestContext: { authorizer: context } };
}

beforeEach(() => {
  setEnv();
  verifyMock.mockReset();
  cognitoSendMock.mockReset();
  // The factor state is now read on every call (it is reported, not just
  // enforced), so give the suite a configured user by default.
  cognitoSendMock.mockResolvedValue({
    UserStatus: 'CONFIRMED',
    UserMFASettingList: ['SOFTWARE_TOKEN_MFA'],
  });
  verifierCreateMock.mockReset();
  verifierCreateMock.mockReturnValue({ verify: verifyMock });
  resetAdminAuthCachesForTests();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('extractBearerToken', () => {
  it('accepts the Bearer prefix case-insensitively and trims', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(extractBearerToken('  bearer   abc  ')).toBe('abc');
  });

  it('rejects missing or malformed headers', () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken('')).toBeNull();
    expect(extractBearerToken('abc.def.ghi')).toBeNull();
  });
});

describe('groupsFromClaim', () => {
  it('handles arrays, space/comma separated strings, and absence', () => {
    expect(groupsFromClaim(['a', 'b'])).toEqual(['a', 'b']);
    expect(groupsFromClaim('a,b c')).toEqual(['a', 'b', 'c']);
    expect(groupsFromClaim(undefined)).toEqual([]);
  });
});

describe('roleFromGroups', () => {
  it('returns the highest-ranked matching role', () => {
    expect(roleFromGroups(['tw-analyst', 'tw-owner', 'tw-support'])).toBe('owner');
    expect(roleFromGroups(['tw-support'])).toBe('support');
  });

  it('ignores unknown groups and returns null when nothing matches', () => {
    expect(roleFromGroups(['some-customer-group'])).toBeNull();
    expect(roleFromGroups([])).toBeNull();
  });
});

describe('resolveAdminIdentity', () => {
  it('resolves a valid token to a role with its rank', async () => {
    verifyMock.mockResolvedValue(tokenPayload({ 'cognito:groups': ['tw-admin'] }));

    const identity = await resolveAdminIdentity('token');

    expect(identity).toMatchObject({
      sub: 'sub-1',
      email: 'admin@example.com',
      role: 'admin',
      roleRank: ROLE_RANK.admin,
      mfa: true,
    });
  });

  it('uses the highest group when a user belongs to several', async () => {
    verifyMock.mockResolvedValue(
      tokenPayload({ 'cognito:groups': ['tw-analyst', 'tw-owner'] })
    );

    await expect(resolveAdminIdentity('token')).resolves.toMatchObject({ role: 'owner' });
  });

  it('creates the verifier once and reuses it', async () => {
    verifyMock.mockResolvedValue(tokenPayload());

    await resolveAdminIdentity('t1');
    await resolveAdminIdentity('t2');

    expect(verifierCreateMock).toHaveBeenCalledTimes(1);
    expect(verifierCreateMock).toHaveBeenCalledWith({
      userPoolId: 'us-east-1_TEST',
      clientId: 'admin-client-id',
      tokenUse: 'id',
    });
  });

  it('rejects a token that fails verification', async () => {
    verifyMock.mockRejectedValue(new Error('Token expired'));

    await expect(resolveAdminIdentity('bad')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('rejects a token without an email claim', async () => {
    verifyMock.mockResolvedValue(tokenPayload({ email: undefined }));

    await expect(resolveAdminIdentity('token')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('rejects an authenticated user with no admin group', async () => {
    verifyMock.mockResolvedValue(tokenPayload({ 'cognito:groups': ['customers'] }));

    await expect(resolveAdminIdentity('token')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('rejects an admin without a TOTP factor when MFA is required', async () => {
    setEnv({ ADMIN_REQUIRE_MFA: 'true' });
    verifyMock.mockResolvedValue(tokenPayload());
    cognitoSendMock.mockResolvedValue({
      UserStatus: 'CONFIRMED',
      UserMFASettingList: [],
    });

    await expect(resolveAdminIdentity('token')).rejects.toMatchObject({
      code: 'MFA_REQUIRED',
    });
  });

  it('accepts an admin with TOTP configured and caches the lookup', async () => {
    setEnv({ ADMIN_REQUIRE_MFA: 'true' });
    verifyMock.mockResolvedValue(tokenPayload());
    cognitoSendMock.mockResolvedValue({
      UserStatus: 'CONFIRMED',
      // Cognito returns the factor name uppercased — this is the real shape.
      UserMFASettingList: ['SOFTWARE_TOKEN_MFA'],
    });

    const first = await resolveAdminIdentity('token');
    const second = await resolveAdminIdentity('token');

    expect(first.mfa).toBe(true);
    expect(second.mfa).toBe(true);
    expect(cognitoSendMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the MFA lookup errors', async () => {
    setEnv({ ADMIN_REQUIRE_MFA: 'true' });
    verifyMock.mockResolvedValue(tokenPayload());
    cognitoSendMock.mockRejectedValue(new Error('throttled'));

    await expect(resolveAdminIdentity('token')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('matches the factor name case-insensitively', async () => {
    setEnv({ ADMIN_REQUIRE_MFA: 'true' });
    verifyMock.mockResolvedValue(tokenPayload());
    cognitoSendMock.mockResolvedValue({
      UserStatus: 'CONFIRMED',
      UserMFASettingList: ['Software_Token_Mfa'],
    });

    await expect(resolveAdminIdentity('token')).resolves.toMatchObject({ mfa: true });
  });

  it('rejects a confirmed user whose only factor is SMS', async () => {
    setEnv({ ADMIN_REQUIRE_MFA: 'true' });
    verifyMock.mockResolvedValue(tokenPayload());
    cognitoSendMock.mockResolvedValue({
      UserStatus: 'CONFIRMED',
      UserMFASettingList: ['SMS_MFA'],
    });

    await expect(resolveAdminIdentity('token')).rejects.toMatchObject({
      code: 'MFA_REQUIRED',
    });
  });
});

describe('requireRole', () => {
  const context = {
    sub: 'sub-1',
    email: 'admin@example.com',
    role: 'support',
    roleRank: ROLE_RANK.support,
    mfa: true,
  };

  it('allows equal or lower-ranked routes', () => {
    expect(requireRole(eventWithAuthorizer(context), 'analyst').role).toBe('support');
    expect(requireRole(eventWithAuthorizer(context), 'support').role).toBe('support');
  });

  it('rejects higher-ranked routes', () => {
    expect(() => requireRole(eventWithAuthorizer(context), 'admin')).toThrow(AdminAuthError);
    try {
      requireRole(eventWithAuthorizer(context), 'owner');
    } catch (error) {
      expect((error as AdminAuthError).code).toBe('FORBIDDEN');
    }
  });

  it('coerces a string rank from the authorizer context', () => {
    const identity = getAdminIdentity(
      eventWithAuthorizer({ ...context, roleRank: String(ROLE_RANK.support) })
    );
    // Role is authoritative; a spoofed numeric rank in context is ignored.
    expect(identity.roleRank).toBe(ROLE_RANK.support);
  });

  it('rejects requests that did not pass through the authorizer', () => {
    expect(() => getAdminIdentity(eventWithAuthorizer(undefined))).toThrow(AdminAuthError);
  });

  it('rejects an unknown role in the context', () => {
    expect(() =>
      getAdminIdentity(eventWithAuthorizer({ ...context, role: 'superuser' }))
    ).toThrow(AdminAuthError);
  });
});
