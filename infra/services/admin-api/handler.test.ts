import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getUserIdMock,
  userQueries,
  analysisQueries,
  portfolioQueries,
  billingQueries,
  agentQueries,
  opsQueries,
  marketQueries,
  dashboardQueries,
  auditQueries,
  creditQueries,
  planOverrideQueries,
  dedupMock,
  sqsMock,
  settingsMock,
  killSwitchMock,
  lambdaMock,
  orderMock,
  memberQueries,
  auditMock,
  presignMock,
  clientState,
} = vi.hoisted(() => ({
  clientState: { userCognitoSub: 'other-sub' },
  getUserIdMock: vi.fn(),
  presignMock: vi.fn(),
  userQueries: {
    listUsers: vi.fn(),
    getUserById: vi.fn(),
    listUserCredits: vi.fn(),
    listUserAnalyses: vi.fn(),
    listUserSessions: vi.fn(),
    listUserPayments: vi.fn(),
    listUserNotes: vi.fn(),
    userExists: vi.fn(),
  },
  analysisQueries: {
    listAnalyses: vi.fn(),
    getAnalysisById: vi.fn(),
    getAnalysisMarketId: vi.fn(),
    getQualityReport: vi.fn(),
  },
  portfolioQueries: {
    listSessions: vi.fn(),
    getSessionById: vi.fn(),
    sessionExists: vi.fn(),
    listSessionTrades: vi.fn(),
    listSessionDecisions: vi.fn(),
    getExposure: vi.fn(),
    getSessionState: vi.fn(),
  },
  billingQueries: {
    listPayments: vi.fn(),
    listSubscriptions: vi.fn(),
    getBillingSummary: vi.fn(),
  },
  agentQueries: {
    listAgentPerformance: vi.fn(),
    getAgentCostReport: vi.fn(),
  },
  opsQueries: {
    getOpsHealth: vi.fn(),
  },
  marketQueries: {
    listSchedules: vi.fn(),
    getScheduleSummary: vi.fn(),
  },
  dashboardQueries: {
    getDashboard: vi.fn(),
  },
  auditQueries: {
    listAuditEntries: vi.fn(),
    findAuditByKey: vi.fn(),
  },
  creditQueries: {
    lockSubscription: vi.fn(),
    addCredits: vi.fn(),
    refundResultDeliveries: vi.fn(),
  },
  planOverrideQueries: {
    getActiveOverride: vi.fn(),
    grantOverride: vi.fn(),
    revokeOverride: vi.fn(),
    expireOverrides: vi.fn(),
  },
  dedupMock: {
    deleteDedupCache: vi.fn(),
    checkInFlight: vi.fn(),
    markInFlight: vi.fn(),
    clearInFlight: vi.fn(),
  },
  sqsMock: {
    send: vi.fn(),
  },
  settingsMock: {
    listSettings: vi.fn(),
    setSetting: vi.fn(),
    resetSettingsCacheForTests: vi.fn(),
    SETTINGS: {},
  },
  killSwitchMock: {
    isHalted: vi.fn(),
    activateUser: vi.fn(),
    resetUser: vi.fn(),
    isGlobalActive: vi.fn(),
    activateGlobal: vi.fn(),
    resetGlobal: vi.fn(),
    isUserActive: vi.fn(),
    publishTriggered: vi.fn(),
  },
  lambdaMock: {
    send: vi.fn(),
  },
  orderMock: {
    cancelPendingOrders: vi.fn(),
  },
  memberQueries: {
    listMembers: vi.fn(),
    listGroupMembers: vi.fn(),
    findUserByEmail: vi.fn(),
    getGroupsForUser: vi.fn(),
    addToGroup: vi.fn(),
    removeFromGroup: vi.fn(),
    countOwners: vi.fn(),
    globalSignOut: vi.fn(),
  },
  auditMock: {
    withAudit: vi.fn(),
    writeAuditLog: vi.fn(),
    completeAudit: vi.fn(),
  },
}));

vi.mock('../shared/db', () => ({
  getUserIdByCognitoSub: getUserIdMock,
}));

vi.mock('./lib/db', () => ({
  // A minimal client: promises for transaction controls, and rows for the few
  // queries the routes read directly.
  withClient: (fn: (client: unknown) => Promise<unknown>) =>
    fn({
      query: vi.fn(async (sql: unknown) => {
        const text = String(sql);
        if (text.includes('FROM users WHERE id = $1')) {
          return { rows: [{ id: '725c2005-b3f4-46f3-94ad-083a75593c02', status: 'active', cognitoSub: clientState.userCognitoSub }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    }),
}));

vi.mock('./queries/users', () => userQueries);

vi.mock('./queries/analyses', () => analysisQueries);

vi.mock('./queries/portfolio', () => portfolioQueries);

vi.mock('./queries/billing', () => billingQueries);

vi.mock('./queries/agents', () => agentQueries);

vi.mock('./queries/ops', () => opsQueries);

vi.mock('./queries/markets', () => marketQueries);

vi.mock('./queries/dashboard', () => dashboardQueries);

vi.mock('./queries/audit', () => auditQueries);

vi.mock('./lib/audit', () => auditMock);

vi.mock('./queries/credits', () => creditQueries);

vi.mock('../shared/plan-overrides', () => planOverrideQueries);

vi.mock('../shared/dynamo', () => dedupMock);

vi.mock('../shared/settings', () => settingsMock);

vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn(() => ({ send: sqsMock.send })),
  SendMessageCommand: vi.fn((input: unknown) => ({ input })),
}));

vi.mock('../shared/kill-switch', () => killSwitchMock);

vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: vi.fn(() => ({ send: lambdaMock.send })),
  InvokeCommand: vi.fn((input: unknown) => ({ input })),
}));

vi.mock('../shared/portfolio-orders', () => orderMock);

vi.mock('./queries/members', () => memberQueries);

vi.mock('./lib/s3', () => ({
  presignPayloadUrl: presignMock,
  PAYLOAD_URL_TTL_SECONDS: 60,
}));

import { ROLE_RANK, type AdminRole } from '../shared/admin-auth';
import { handler } from './handler';
import { ROUTES } from './lib/router';
import type { AdminApiEvent, ApiResponse } from './lib/types';

const ORIGINAL_ENV = { ...process.env };

const ALLOWED_ORIGIN = 'https://admin.tradewizard.live';
const OTHER_ORIGIN = 'https://evil.example.com';
const USER_ID = '725c2005-b3f4-46f3-94ad-083a75593c02';

/**
 * The authorization matrix. Every route must appear here — the first test fails
 * when a route is added without an entry, which is the point.
 */
const ROUTE_MATRIX: Array<{
  method: AdminApiEvent['httpMethod'];
  path: string;
  minimumRole: AdminRole;
}> = [
  { method: 'GET', path: '/admin/me', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/users', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/users/{id}', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/users/{id}/credits', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/users/{id}/analyses', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/users/{id}/sessions', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/users/{id}/payments', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/users/{id}/notes', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/analyses', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/analyses/quality', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/analyses/{id}', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/portfolio/sessions', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/portfolio/exposure', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/portfolio/sessions/{id}', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/portfolio/sessions/{id}/trades', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/portfolio/sessions/{id}/decisions', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/billing/summary', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/payments', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/subscriptions', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/agents/performance', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/agents/cost', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/ops/health', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/markets/summary', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/markets/schedule', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/dashboard/summary', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/audit', minimumRole: 'analyst' },
  { method: 'POST', path: '/admin/users/{id}/notes', minimumRole: 'support' },
  { method: 'POST', path: '/admin/users/{id}/credits', minimumRole: 'support' },
  { method: 'POST', path: '/admin/users/{id}/status', minimumRole: 'admin' },
  { method: 'POST', path: '/admin/users/{id}/plan-override', minimumRole: 'admin' },
  { method: 'DELETE', path: '/admin/users/{id}/plan-override', minimumRole: 'admin' },
  { method: 'POST', path: '/admin/analyses/{id}/invalidate-cache', minimumRole: 'admin' },
  { method: 'POST', path: '/admin/analyses/{id}/refund', minimumRole: 'admin' },
  { method: 'POST', path: '/admin/portfolio/sessions/{id}/pause', minimumRole: 'support' },
  { method: 'POST', path: '/admin/portfolio/sessions/{id}/resume', minimumRole: 'support' },
  { method: 'POST', path: '/admin/portfolio/kill-switch', minimumRole: 'admin' },
  { method: 'DELETE', path: '/admin/portfolio/kill-switch', minimumRole: 'admin' },
  { method: 'GET', path: '/admin/admins', minimumRole: 'owner' },
  { method: 'POST', path: '/admin/admins', minimumRole: 'owner' },
  { method: 'PUT', path: '/admin/admins/{sub}', minimumRole: 'owner' },
  { method: 'DELETE', path: '/admin/admins/{sub}', minimumRole: 'owner' },
  { method: 'POST', path: '/admin/portfolio/sessions/{id}/terminate', minimumRole: 'admin' },
  { method: 'POST', path: '/admin/analyses/requeue', minimumRole: 'admin' },
  { method: 'GET', path: '/admin/settings', minimumRole: 'admin' },
  { method: 'PUT', path: '/admin/settings/{key}', minimumRole: 'owner' },
];

const ALL_ROLES: AdminRole[] = ['analyst', 'support', 'admin', 'owner'];

const QUERY_FNS = [
  ...Object.values(userQueries),
  ...Object.values(analysisQueries),
  ...Object.values(portfolioQueries),
];

function resolvePath(template: string): string {
  return template.replace('{id}', USER_ID);
}

function makeEvent(
  overrides: Partial<AdminApiEvent> & {
    role?: AdminRole | 'none';
    withAuthorizer?: boolean;
  } = {}
): AdminApiEvent {
  const { role = 'owner', withAuthorizer = true, ...rest } = overrides;

  // Mutations need a body that satisfies their schema, so the default depends
  // on the route. Read routes ignore it.
  const path = rest.path ?? '/admin/me';
  // A body that satisfies each mutation's schema. Read routes ignore it.
  const REASON = 'matrix test reason';
  const bodyFor = (routePath: string): string => {
    if (routePath.endsWith('/credits')) return JSON.stringify({ amount: 10, reason: REASON });
    if (routePath.endsWith('/status')) return JSON.stringify({ status: 'suspended', reason: REASON });
    if (routePath.endsWith('/plan-override'))
      return JSON.stringify({ plan: 'pro', expiresAt: null, reason: REASON });
    if (routePath.includes('/settings/'))
      return JSON.stringify({ value: true, reason: REASON });
    if (routePath.endsWith('/requeue'))
      return JSON.stringify({ marketId: '0xmarket123', reason: REASON });
    if (routePath.includes('/admins'))
      return JSON.stringify({ email: 'new@example.com', role: 'support', reason: REASON });
    if (routePath.endsWith('/kill-switch'))
      return JSON.stringify({ userId: '725c2005-b3f4-46f3-94ad-083a75593c02', reason: REASON });
    if (
      routePath.endsWith('/invalidate-cache') ||
      routePath.endsWith('/refund') ||
      routePath.endsWith('/pause') ||
      routePath.endsWith('/resume') ||
      routePath.endsWith('/terminate')
    ) {
      return JSON.stringify({ reason: REASON });
    }
    return JSON.stringify({ body: 'verification note', reason: REASON });
  };
  const defaultBody = bodyFor(path);

  return {
    httpMethod: 'GET',
    path: '/admin/me',
    headers: { origin: ALLOWED_ORIGIN },
    queryStringParameters: null,
    pathParameters: null,
    body: defaultBody,
    requestContext: {
      requestId: 'req-1',
      authorizer: withAuthorizer
        ? {
            sub: 'sub-1',
            email: 'admin@example.com',
            role: role === 'none' ? undefined : role,
            roleRank: role === 'none' ? undefined : ROLE_RANK[role],
            mfa: true,
            // Fresh by default; one test overrides this to prove the guard.
            authTime: Math.floor(Date.now() / 1000),
          }
        : undefined,
    },
    ...rest,
  };
}

function body(response: ApiResponse): Record<string, unknown> {
  return JSON.parse(response.body);
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.ADMIN_ALLOWED_ORIGINS = `${ALLOWED_ORIGIN},http://localhost:3001`;
  // Required for the kill-switch dispatch path.
  process.env.RISK_ENGINE_FUNCTION_NAME = 'tw-dev-portfolio-risk-engine';
  process.env.ANALYSIS_QUEUE_URL = 'https://sqs.example/queue';

  getUserIdMock.mockReset();
  getUserIdMock.mockResolvedValue('user-uuid-1');

  for (const fn of QUERY_FNS) fn.mockReset();
  userQueries.listUsers.mockResolvedValue([]);
  userQueries.getUserById.mockResolvedValue({ id: USER_ID, email: 'user@example.com' });
  userQueries.listUserCredits.mockResolvedValue([]);
  userQueries.listUserAnalyses.mockResolvedValue([]);
  userQueries.listUserSessions.mockResolvedValue([]);
  userQueries.listUserPayments.mockResolvedValue([]);
  userQueries.listUserNotes.mockResolvedValue([]);
  userQueries.userExists.mockResolvedValue(true);

  analysisQueries.listAnalyses.mockResolvedValue([]);
  analysisQueries.getAnalysisMarketId.mockResolvedValue('0xmarket');
  analysisQueries.getAnalysisById.mockResolvedValue({
    id: USER_ID,
    payloadKey: 'analyses/2026/result.json',
  });
  analysisQueries.getQualityReport.mockResolvedValue({
    window: { from: '2026-01-01T00:00:00.000Z', to: '2026-01-08T00:00:00.000Z' },
    totals: {},
    recommendations: [],
    noTradeReasons: [],
    edgeBuckets: [],
    outcomes: [],
    shadow: {},
  });
  portfolioQueries.listSessions.mockResolvedValue([]);
  portfolioQueries.getSessionById.mockResolvedValue({ id: USER_ID, status: 'active' });
  portfolioQueries.sessionExists.mockResolvedValue(true);
  portfolioQueries.listSessionTrades.mockResolvedValue([]);
  portfolioQueries.listSessionDecisions.mockResolvedValue([]);
  portfolioQueries.getExposure.mockResolvedValue({ totals: {}, byPersona: [] });
  portfolioQueries.getSessionState.mockResolvedValue({
    userId: USER_ID,
    status: 'active',
    accountStatus: 'active',
  });

  billingQueries.listPayments.mockResolvedValue([]);
  billingQueries.listSubscriptions.mockResolvedValue([]);
  billingQueries.getBillingSummary.mockResolvedValue({
    window: { from: '2026-01-01T00:00:00.000Z', to: '2026-01-08T00:00:00.000Z' },
    revenue: {},
    byPlan: [],
    renewal: {},
  });

  agentQueries.listAgentPerformance.mockResolvedValue([]);
  agentQueries.getAgentCostReport.mockResolvedValue({
    window: { from: '2026-01-01T00:00:00.000Z', to: '2026-01-08T00:00:00.000Z' },
    totals: {},
    byMarket: [],
  });

  dashboardQueries.getDashboard.mockResolvedValue({ days: [], totals: {}, stale: false });
  auditQueries.listAuditEntries.mockResolvedValue([]);
  auditQueries.findAuditByKey.mockResolvedValue(null);

  creditQueries.lockSubscription.mockResolvedValue({
    creditsRemaining: 100,
    creditsMonthlyLimit: 100,
    plan: 'pro',
  });
  creditQueries.addCredits.mockResolvedValue(110);
  creditQueries.refundResultDeliveries.mockResolvedValue({
    refunded: 2,
    skipped: 0,
    totalRecipients: 2,
  });

  memberQueries.listMembers.mockResolvedValue([]);
  memberQueries.findUserByEmail.mockResolvedValue({
    sub: 'new-sub',
    email: 'new@example.com',
    status: 'CONFIRMED',
  });
  memberQueries.getGroupsForUser.mockResolvedValue([]);
  memberQueries.addToGroup.mockResolvedValue(undefined);
  memberQueries.removeFromGroup.mockResolvedValue(undefined);
  memberQueries.countOwners.mockResolvedValue(2);
  memberQueries.globalSignOut.mockResolvedValue(undefined);

  killSwitchMock.isHalted.mockResolvedValue(false);
  killSwitchMock.activateUser.mockResolvedValue({ active: true, triggeredAt: '2026-11-02T00:00:00.000Z', reason: 'test', ttl: 1 });
  killSwitchMock.resetUser.mockResolvedValue(undefined);
  lambdaMock.send.mockReset();
  lambdaMock.send.mockResolvedValue({});
  orderMock.cancelPendingOrders.mockResolvedValue({ cancelled: 1, releasedUsdc: 25 });

  sqsMock.send.mockReset();
  sqsMock.send.mockResolvedValue({});
  settingsMock.listSettings.mockResolvedValue([]);
  settingsMock.setSetting.mockResolvedValue(undefined);
  dedupMock.checkInFlight.mockResolvedValue(null);
  dedupMock.markInFlight.mockResolvedValue(undefined);
  dedupMock.clearInFlight.mockResolvedValue(undefined);

  dedupMock.deleteDedupCache.mockReset();
  dedupMock.deleteDedupCache.mockResolvedValue(2);

  planOverrideQueries.getActiveOverride.mockResolvedValue(null);
  planOverrideQueries.grantOverride.mockResolvedValue(undefined);
  planOverrideQueries.revokeOverride.mockResolvedValue({ restoredPlan: 'free' });

  auditMock.writeAuditLog.mockReset();
  auditMock.writeAuditLog.mockResolvedValue('audit-id-1');
  auditMock.completeAudit.mockReset();
  auditMock.completeAudit.mockResolvedValue(undefined);
  auditMock.withAudit.mockReset();
  // The audit wrapper is mocked as a unit: the matrix and contract tests only
  // care that it was invoked with the right metadata. The real transaction is
  // exercised against the database by the operational verification.
  auditMock.withAudit.mockResolvedValue({
    id: 'note-id-1',
    body: 'verification note',
    createdAt: '2026-11-02T00:00:00.000Z',
  });
  marketQueries.listSchedules.mockResolvedValue([]);
  marketQueries.getScheduleSummary.mockResolvedValue({ total: 0, active: 0, executing: 0, stuck: 0 });

  opsQueries.getOpsHealth.mockResolvedValue({
    generatedAt: '2026-01-01T00:00:00.000Z',
    windowHours: 24,
    queues: { analysis: null, deadLetter: null },
    functions: [],
    alarms: [],
    websocket: { approxConnections: null, note: 'approx' },
    database: { reachable: true, sizeBytes: 1, connections: 2 },
  });

  presignMock.mockReset();
  presignMock.mockResolvedValue('https://s3.example/signed');

  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('authorization matrix', () => {
  it('has an explicit matrix entry for every route', () => {
    const declared = ROUTES.map((route) => ({
      method: route.method,
      path: route.path,
      minimumRole: route.minimumRole,
    }));

    // Order-insensitive: the route table groups by domain, the matrix is flat.
    const sort = (rows: Array<{ method: string; path: string; minimumRole: string }>) =>
      [...rows].sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));

    expect(sort(declared)).toEqual(sort(ROUTE_MATRIX));
  });

  it.each(
    ROUTE_MATRIX.flatMap((route) => ALL_ROLES.map((role) => ({ route, role })))
  )('$route.method $route.path as $role', async ({ route, role }) => {
    for (const fn of QUERY_FNS) fn.mockClear();
    getUserIdMock.mockClear();

    const response = await handler(
      makeEvent({
        httpMethod: route.method,
        path: resolvePath(route.path),
        role,
      })
    );

    const allowed = ROLE_RANK[role] >= ROLE_RANK[route.minimumRole];

    if (allowed) {
      // The property under test is authorization, not business outcome:
      // mutations answer 201, and a precondition can legitimately answer 409.
      // A 5xx would still fail, which is what catches real breakage.
      expect(response.statusCode).not.toBe(401);
      expect(response.statusCode).not.toBe(403);
      expect(response.statusCode).toBeLessThan(500);
    } else {
      expect(response.statusCode).toBe(403);
      expect(body(response).error).toMatchObject({ code: 'FORBIDDEN' });
      // The critical property: a rejected call must not reach the database.
      for (const fn of QUERY_FNS) expect(fn).not.toHaveBeenCalled();
      expect(getUserIdMock).not.toHaveBeenCalled();
    }
  });
});

describe('request handling', () => {
  it('returns 404 for an unknown route', async () => {
    const response = await handler(makeEvent({ path: '/admin/nope' }));

    expect(response.statusCode).toBe(404);
    expect(body(response).error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns 404 for an unsupported method on a known path', async () => {
    const response = await handler(makeEvent({ httpMethod: 'DELETE', path: '/admin/me' }));

    expect(response.statusCode).toBe(404);
  });

  it('returns 401 when the authorizer context is missing', async () => {
    const response = await handler(makeEvent({ withAuthorizer: false }));

    expect(response.statusCode).toBe(401);
    expect(body(response).error).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(getUserIdMock).not.toHaveBeenCalled();
  });

  it('returns 401 when the token carried no admin role', async () => {
    const response = await handler(makeEvent({ role: 'none' }));

    expect(response.statusCode).toBe(401);
  });

  it('returns the identity and links the product account', async () => {
    const response = await handler(makeEvent({ role: 'support' }));
    const payload = body(response).data as Record<string, unknown>;

    expect(response.statusCode).toBe(200);
    expect(payload).toMatchObject({
      sub: 'sub-1',
      email: 'admin@example.com',
      role: 'support',
      roleRank: ROLE_RANK.support,
      userId: 'user-uuid-1',
      linked: true,
    });
  });

  it('reports linked=false when the admin has no product account', async () => {
    getUserIdMock.mockResolvedValue(null);

    const payload = body(await handler(makeEvent())).data as Record<string, unknown>;

    expect(payload.linked).toBe(false);
    expect(payload.userId).toBeNull();
  });

  it('returns 500 without leaking internals when the handler throws', async () => {
    getUserIdMock.mockRejectedValue(new Error('connection refused'));

    const response = await handler(makeEvent());

    expect(response.statusCode).toBe(500);
    expect(body(response).error).toMatchObject({ code: 'INTERNAL' });
    expect(JSON.stringify(body(response))).not.toContain('connection refused');
  });
});

describe('users list', () => {
  it('clamps the page size and passes filters through', async () => {
    await handler(
      makeEvent({
        path: '/admin/users',
        queryStringParameters: { limit: '9999', q: ' alice ', plan: 'pro', hasPm: 'true' },
      })
    );

    expect(userQueries.listUsers).toHaveBeenCalledWith(
      expect.anything(),
      { q: 'alice', plan: 'pro', status: null, hasPm: true },
      200,
      null
    );
  });

  it('defaults to 25 rows and no filters', async () => {
    await handler(makeEvent({ path: '/admin/users' }));

    expect(userQueries.listUsers).toHaveBeenCalledWith(
      expect.anything(),
      { q: null, plan: null, status: null, hasPm: false },
      25,
      null
    );
  });

  it('rejects an unknown plan or status', async () => {
    const badPlan = await handler(
      makeEvent({ path: '/admin/users', queryStringParameters: { plan: 'platinum' } })
    );
    const badStatus = await handler(
      makeEvent({ path: '/admin/users', queryStringParameters: { status: 'deleted' } })
    );

    expect(badPlan.statusCode).toBe(400);
    expect(badStatus.statusCode).toBe(400);
    expect(userQueries.listUsers).not.toHaveBeenCalled();
  });

  it('emits a next cursor and drops the sentinel row', async () => {
    const rows = Array.from({ length: 3 }, (_, index) => ({
      id: `00000000-0000-0000-0000-00000000000${index}`,
      createdAt: new Date(Date.UTC(2026, 0, 3 - index)),
    }));
    userQueries.listUsers.mockResolvedValue(rows);

    const response = await handler(
      makeEvent({ path: '/admin/users', queryStringParameters: { limit: '2' } })
    );

    const payload = body(response) as { data: unknown[]; meta: { nextCursor: string } };
    expect(payload.data).toHaveLength(2);
    expect(payload.meta.nextCursor).toBeTruthy();
  });
});

describe('user detail', () => {
  it('rejects a malformed id', async () => {
    const response = await handler(makeEvent({ path: '/admin/users/not-a-uuid' }));

    expect(response.statusCode).toBe(400);
    expect(userQueries.getUserById).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown user', async () => {
    userQueries.getUserById.mockResolvedValue(null);

    const response = await handler(makeEvent({ path: `/admin/users/${USER_ID}` }));

    expect(response.statusCode).toBe(404);
  });

  it('404s a sub-resource list for an unknown user', async () => {
    userQueries.userExists.mockResolvedValue(false);

    const response = await handler(makeEvent({ path: `/admin/users/${USER_ID}/credits` }));

    expect(response.statusCode).toBe(404);
    expect(userQueries.listUserCredits).not.toHaveBeenCalled();
  });
});

describe('analyses', () => {
  it('passes validated filters through to the query', async () => {
    await handler(
      makeEvent({
        path: '/admin/analyses',
        queryStringParameters: {
          recommendation: 'LONG_YES',
          outcome: 'success',
          marketId: '0xabc',
          from: '2026-10-01',
          to: '2026-10-08',
        },
      })
    );

    expect(analysisQueries.listAnalyses).toHaveBeenCalledWith(
      expect.anything(),
      {
        marketId: '0xabc',
        userId: null,
        recommendation: 'LONG_YES',
        outcome: 'success',
        noTradeReason: null,
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-08T00:00:00.000Z',
      },
      25,
      null
    );
  });

  it('rejects a non-uuid userId and an unknown recommendation', async () => {
    const badUser = await handler(
      makeEvent({ path: '/admin/analyses', queryStringParameters: { userId: 'nope' } })
    );
    const badRecommendation = await handler(
      makeEvent({ path: '/admin/analyses', queryStringParameters: { recommendation: 'MOON' } })
    );

    expect(badUser.statusCode).toBe(400);
    expect(badRecommendation.statusCode).toBe(400);
    expect(analysisQueries.listAnalyses).not.toHaveBeenCalled();
  });

  it('returns a presigned payload url with a 60 second ttl', async () => {
    const response = await handler(makeEvent({ path: `/admin/analyses/${USER_ID}` }));
    const payload = body(response).data as Record<string, unknown>;

    expect(response.statusCode).toBe(200);
    expect(presignMock).toHaveBeenCalledWith('analyses/2026/result.json');
    expect(payload.payloadUrl).toBe('https://s3.example/signed');
    expect(payload.payloadUrlExpiresInSeconds).toBe(60);
    // The raw key must not leak to the client.
    expect(payload.payloadKey).toBeUndefined();
  });

  it('404s an unknown analysis without presigning anything', async () => {
    analysisQueries.getAnalysisById.mockResolvedValue(null);

    const response = await handler(makeEvent({ path: `/admin/analyses/${USER_ID}` }));

    expect(response.statusCode).toBe(404);
    expect(presignMock).not.toHaveBeenCalled();
  });

  it('rejects a quality window longer than 90 days', async () => {
    const response = await handler(
      makeEvent({
        path: '/admin/analyses/quality',
        queryStringParameters: { from: '2026-01-01', to: '2026-06-01' },
      })
    );

    expect(response.statusCode).toBe(400);
    expect(analysisQueries.getQualityReport).not.toHaveBeenCalled();
  });

  it('defaults the quality window to the last 7 days', async () => {
    const response = await handler(makeEvent({ path: '/admin/analyses/quality' }));

    expect(response.statusCode).toBe(200);
    const window = analysisQueries.getQualityReport.mock.calls[0][1];
    const spanDays = (new Date(window.to).getTime() - new Date(window.from).getTime()) / 86_400_000;
    expect(spanDays).toBeCloseTo(7, 5);
  });
});

describe('billing and agents', () => {
  it('rejects an unknown payment type', async () => {
    const response = await handler(
      makeEvent({ path: '/admin/payments', queryStringParameters: { type: 'bribe' } })
    );

    expect(response.statusCode).toBe(400);
    expect(billingQueries.listPayments).not.toHaveBeenCalled();
  });

  it('rejects an unknown renewal state', async () => {
    const response = await handler(
      makeEvent({ path: '/admin/subscriptions', queryStringParameters: { renewal: 'expired' } })
    );

    expect(response.statusCode).toBe(400);
    expect(billingQueries.listSubscriptions).not.toHaveBeenCalled();
  });

  it('passes payment date bounds through as ISO timestamps', async () => {
    await handler(
      makeEvent({
        path: '/admin/payments',
        queryStringParameters: { from: '2026-10-01', to: '2026-10-05', type: 'renewal_payment' },
      })
    );

    expect(billingQueries.listPayments).toHaveBeenCalledWith(
      expect.anything(),
      { from: '2026-10-01T00:00:00.000Z', to: '2026-10-05T00:00:00.000Z', type: 'renewal_payment' },
      25,
      null
    );
  });

  it('bounds the billing summary window', async () => {
    const response = await handler(
      makeEvent({
        path: '/admin/billing/summary',
        queryStringParameters: { from: '2025-01-01', to: '2026-01-01' },
      })
    );

    expect(response.statusCode).toBe(400);
    expect(billingQueries.getBillingSummary).not.toHaveBeenCalled();
  });

  it('writes a note under the audit contract', async () => {
    const response = await handler(
      makeEvent({ httpMethod: 'POST', path: `/admin/users/${USER_ID}/notes`, role: 'support' })
    );

    expect(response.statusCode).toBe(201);
    expect(auditMock.withAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'user.note.create',
        targetType: 'user',
        targetId: USER_ID,
        reason: 'matrix test reason',
      }),
      expect.any(Function)
    );
  });

  it('invalidates the analysis cache for the result\'s market', async () => {
    analysisQueries.getAnalysisMarketId.mockResolvedValue('0xmarket');

    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/analyses/${USER_ID}/invalidate-cache`,
        role: 'admin',
        body: JSON.stringify({ reason: 'stale data reported by user' }),
      })
    );

    expect(response.statusCode).toBe(200);
    expect(dedupMock.deleteDedupCache).toHaveBeenCalledWith('0xmarket');
    expect(body(response).data).toMatchObject({ marketId: '0xmarket', deletedEntries: 2 });
  });

  it('adds a member by email', async () => {
    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: '/admin/admins',
        role: 'owner',
        body: JSON.stringify({ email: 'new@example.com', role: 'support', reason: 'new support hire' }),
      })
    );

    expect(response.statusCode).toBe(201);
    expect(memberQueries.addToGroup).toHaveBeenCalledWith('new-sub', 'tw-support');
    expect(body(response).data).toMatchObject({ sub: 'new-sub', role: 'support' });
  });

  it('refuses to add someone who is already a member', async () => {
    memberQueries.getGroupsForUser.mockResolvedValue(['tw-support']);

    const response = await handler(
      makeEvent({ httpMethod: 'POST', path: '/admin/admins', role: 'owner' })
    );

    expect(response.statusCode).toBe(409);
    expect(memberQueries.addToGroup).not.toHaveBeenCalled();
  });

  it('404s when no account uses that email', async () => {
    memberQueries.findUserByEmail.mockResolvedValue(null);

    const response = await handler(
      makeEvent({ httpMethod: 'POST', path: '/admin/admins', role: 'owner' })
    );

    expect(response.statusCode).toBe(404);
  });

  it('refuses to demote the last owner', async () => {
    memberQueries.getGroupsForUser.mockResolvedValue(['tw-owner']);
    memberQueries.countOwners.mockResolvedValue(1);

    const response = await handler(
      makeEvent({
        httpMethod: 'PUT',
        path: `/admin/admins/${USER_ID}`,
        role: 'owner',
        body: JSON.stringify({ role: 'admin', reason: 'demoting the only owner' }),
      })
    );

    expect(response.statusCode).toBe(409);
    expect(memberQueries.removeFromGroup).not.toHaveBeenCalled();
  });

  it('refuses to remove the last owner', async () => {
    memberQueries.getGroupsForUser.mockResolvedValue(['tw-owner']);
    memberQueries.countOwners.mockResolvedValue(1);

    const response = await handler(
      makeEvent({
        httpMethod: 'DELETE',
        path: `/admin/admins/${USER_ID}`,
        role: 'owner',
        body: JSON.stringify({ reason: 'removing the only owner' }),
      })
    );

    expect(response.statusCode).toBe(409);
  });

  it('changes a member role and records the previous one', async () => {
    memberQueries.getGroupsForUser.mockResolvedValue(['tw-support']);

    const response = await handler(
      makeEvent({
        httpMethod: 'PUT',
        path: `/admin/admins/${USER_ID}`,
        role: 'owner',
        body: JSON.stringify({ role: 'admin', reason: 'promoting to admin' }),
      })
    );

    expect(response.statusCode).toBe(200);
    expect(memberQueries.removeFromGroup).toHaveBeenCalledWith(USER_ID, 'tw-support');
    expect(memberQueries.addToGroup).toHaveBeenCalledWith(USER_ID, 'tw-admin');
    // A demotion must not wait for the old token to expire.
    expect(memberQueries.globalSignOut).toHaveBeenCalledWith(USER_ID);
    expect(body(response).data).toMatchObject({ role: 'admin', previousRole: 'support' });
  });

  it('halts trading synchronously and dispatches the exit', async () => {
    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: '/admin/portfolio/kill-switch',
        role: 'admin',
        body: JSON.stringify({ userId: USER_ID, reason: 'runaway session, halting now' }),
      })
    );

    expect(response.statusCode).toBe(202);
    expect(killSwitchMock.activateUser).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ reason: 'runaway session, halting now' })
    );
    expect(lambdaMock.send).toHaveBeenCalledTimes(1);
    // Event invocation: the caller must not wait for the exit.
    expect(lambdaMock.send.mock.calls[0][0].input.InvocationType).toBe('Event');
    expect(body(response).data).toMatchObject({ halted: true, exitsDispatched: true });
  });

  it('reports a failed exit dispatch but keeps the halt', async () => {
    lambdaMock.send.mockRejectedValueOnce(new Error('invoke denied'));

    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: '/admin/portfolio/kill-switch',
        role: 'admin',
      })
    );

    expect(response.statusCode).toBe(202);
    expect(body(response).data).toMatchObject({ halted: true, exitsDispatched: false });
  });

  it('requires a recent sign-in for the kill switch', async () => {
    const event = makeEvent({
      httpMethod: 'POST',
      path: '/admin/portfolio/kill-switch',
      role: 'admin',
    });
    // Two hours old.
    event.requestContext!.authorizer!.authTime = Math.floor(Date.now() / 1000) - 7200;

    const response = await handler(event);

    expect(response.statusCode).toBe(403);
    expect(body(response).error).toMatchObject({ code: 'REAUTH_REQUIRED' });
    expect(killSwitchMock.activateUser).not.toHaveBeenCalled();
  });

  it('resets the kill switch', async () => {
    const response = await handler(
      makeEvent({
        httpMethod: 'DELETE',
        path: '/admin/portfolio/kill-switch',
        role: 'admin',
      })
    );

    expect(response.statusCode).toBe(200);
    expect(killSwitchMock.resetUser).toHaveBeenCalledWith(USER_ID);
  });

  it('pauses a session and cancels its working orders', async () => {
    // This route's result comes from inside withAudit, so the mock must run it.
    auditMock.withAudit.mockImplementationOnce(
      async (_client: unknown, _params: unknown, work: (id: string) => Promise<{ result: unknown }>) =>
        (await work('audit-id-1')).result
    );

    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/portfolio/sessions/${USER_ID}/pause`,
        role: 'support',
        body: JSON.stringify({ reason: 'pausing while support investigates' }),
      })
    );

    expect(response.statusCode).toBe(200);
    expect(orderMock.cancelPendingOrders).toHaveBeenCalledWith(expect.anything(), USER_ID);
  });

  it('terminates a session by dispatching the exit', async () => {
    portfolioQueries.getSessionState.mockResolvedValue({
      userId: USER_ID,
      status: 'active',
      accountStatus: 'active',
    });

    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/portfolio/sessions/${USER_ID}/terminate`,
        role: 'admin',
        body: JSON.stringify({ reason: 'closing a session at the user request' }),
      })
    );

    expect(response.statusCode).toBe(202);
    expect(lambdaMock.send).toHaveBeenCalledTimes(1);
    expect(body(response).data).toMatchObject({ exitsDispatched: true });
    expect(auditMock.completeAudit).toHaveBeenCalledWith(
      expect.anything(),
      'audit-id-1',
      expect.objectContaining({ status: 'succeeded' })
    );
  });

  it('refuses to terminate a session that already ended', async () => {
    portfolioQueries.getSessionState.mockResolvedValue({
      userId: USER_ID,
      status: 'terminated',
      accountStatus: 'active',
    });

    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/portfolio/sessions/${USER_ID}/terminate`,
        role: 'admin',
        body: JSON.stringify({ reason: 'terminating twice is pointless' }),
      })
    );

    expect(response.statusCode).toBe(409);
    expect(lambdaMock.send).not.toHaveBeenCalled();
  });

  it('refuses to resume while a kill switch is active', async () => {
    portfolioQueries.getSessionState.mockResolvedValue({
      userId: USER_ID,
      status: 'paused',
      accountStatus: 'active',
    });
    killSwitchMock.isHalted.mockResolvedValue(true);

    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/portfolio/sessions/${USER_ID}/resume`,
        role: 'support',
        body: JSON.stringify({ reason: 'attempting resume during a halt' }),
      })
    );

    expect(response.statusCode).toBe(409);
  });

  it('refuses to resume a suspended account', async () => {
    portfolioQueries.getSessionState.mockResolvedValue({
      userId: USER_ID,
      status: 'paused',
      accountStatus: 'suspended',
    });

    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/portfolio/sessions/${USER_ID}/resume`,
        role: 'support',
        body: JSON.stringify({ reason: 'attempting resume while suspended' }),
      })
    );

    expect(response.statusCode).toBe(409);
  });

  it('requeues an analysis as a scheduled fire', async () => {
    process.env.ANALYSIS_QUEUE_URL = 'https://sqs.example/queue';

    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: '/admin/analyses/requeue',
        role: 'admin',
        body: JSON.stringify({ marketId: '0xmarket123', reason: 'stale result, forcing a rerun' }),
      })
    );

    expect(response.statusCode).toBe(202);
    expect(dedupMock.markInFlight).toHaveBeenCalledWith('0xmarket123', expect.any(String));

    const body0 = JSON.parse(sqsMock.send.mock.calls[0][0].input.MessageBody);
    // The mode matters: isScheduledFire stops the orchestrator from adding the
    // requester to delivery targets, so nobody is charged.
    expect(body0).toMatchObject({ isScheduledFire: true, requestType: 'recurring', marketId: '0xmarket123' });
  });

  it('refuses to requeue while an analysis is already in flight', async () => {
    process.env.ANALYSIS_QUEUE_URL = 'https://sqs.example/queue';
    dedupMock.checkInFlight.mockResolvedValue('existing-request');

    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: '/admin/analyses/requeue',
        role: 'admin',
        body: JSON.stringify({ marketId: '0xmarket123', reason: 'trying to double dispatch' }),
      })
    );

    expect(response.statusCode).toBe(409);
    expect(sqsMock.send).not.toHaveBeenCalled();
  });

  it('refunds every recipient of a result', async () => {
    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/analyses/${USER_ID}/refund`,
        role: 'admin',
        body: JSON.stringify({ reason: 'wrong market analysed by mistake' }),
      })
    );

    expect(response.statusCode).toBe(200);
    expect(creditQueries.refundResultDeliveries).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      'admin@example.com'
    );
    expect(body(response).data).toMatchObject({ refunded: 2, totalRecipients: 2 });
  });

  it('404s refunds for an unknown analysis', async () => {
    analysisQueries.getAnalysisMarketId.mockResolvedValue(null);

    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/analyses/${USER_ID}/refund`,
        role: 'admin',
        body: JSON.stringify({ reason: 'should not refund anything' }),
      })
    );

    expect(response.statusCode).toBe(404);
    expect(creditQueries.refundResultDeliveries).not.toHaveBeenCalled();
  });

  it('404s cache invalidation for an unknown analysis', async () => {
    analysisQueries.getAnalysisMarketId.mockResolvedValue(null);

    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/analyses/${USER_ID}/invalidate-cache`,
        role: 'admin',
        body: JSON.stringify({ reason: 'should not reach dynamo' }),
      })
    );

    expect(response.statusCode).toBe(404);
    expect(dedupMock.deleteDedupCache).not.toHaveBeenCalled();
  });

  it('applies a plan override and pauses renewal', async () => {
    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/users/${USER_ID}/plan-override`,
        role: 'admin',
        body: JSON.stringify({ plan: 'elite', reason: 'partner comp for launch' }),
      })
    );

    expect(response.statusCode).toBe(201);
    expect(planOverrideQueries.grantOverride).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: USER_ID, plan: 'elite', currentPlan: 'pro' })
    );
    expect(body(response).data).toMatchObject({ plan: 'elite', renewalPaused: true });
  });

  it('rejects an unknown plan', async () => {
    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/users/${USER_ID}/plan-override`,
        role: 'admin',
        body: JSON.stringify({ plan: 'platinum', reason: 'invalid plan value' }),
      })
    );

    expect(response.statusCode).toBe(400);
    expect(planOverrideQueries.grantOverride).not.toHaveBeenCalled();
  });

  it('revokes a plan override and restores the previous plan', async () => {
    // This route's result comes from inside withAudit, so the mock must run it.
    auditMock.withAudit.mockImplementationOnce(
      async (_client: unknown, _params: unknown, work: (id: string) => Promise<{ result: unknown }>) =>
        (await work('audit-id-1')).result
    );

    const response = await handler(
      makeEvent({
        httpMethod: 'DELETE',
        path: `/admin/users/${USER_ID}/plan-override`,
        role: 'admin',
        body: JSON.stringify({ reason: 'partner comp ended early' }),
      })
    );

    expect(response.statusCode).toBe(200);
    expect(body(response).data).toMatchObject({ restoredPlan: 'free' });
  });

  it('refuses to change your own account status', async () => {
    clientState.userCognitoSub = 'sub-1';

    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/users/${USER_ID}/status`,
        role: 'admin',
        body: JSON.stringify({ status: 'suspended', reason: 'testing self suspension' }),
      })
    );

    clientState.userCognitoSub = 'other-sub';
    expect(response.statusCode).toBe(409);
    expect(auditMock.withAudit).not.toHaveBeenCalled();
  });

  it('rejects an unknown account status', async () => {
    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/users/${USER_ID}/status`,
        role: 'admin',
        body: JSON.stringify({ status: 'deleted', reason: 'invalid status value' }),
      })
    );

    expect(response.statusCode).toBe(400);
    expect(auditMock.withAudit).not.toHaveBeenCalled();
  });

  it('grants credits and records the balance change', async () => {
    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/users/${USER_ID}/credits`,
        role: 'support',
        body: JSON.stringify({ amount: 10, reason: 'goodwill credit for outage' }),
      })
    );

    expect(response.statusCode).toBe(201);
    expect(creditQueries.addCredits).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: USER_ID, amount: 10, reason: 'admin_credit_grant' })
    );
    expect(body(response).data).toMatchObject({ credited: 10, creditsRemaining: 110 });
    expect(auditMock.completeAudit).toHaveBeenCalledWith(
      expect.anything(),
      'audit-id-1',
      expect.objectContaining({ status: 'succeeded' })
    );
  });

  it('rejects a non-positive credit amount', async () => {
    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/users/${USER_ID}/credits`,
        role: 'support',
        body: JSON.stringify({ amount: 0, reason: 'zero credits request' }),
      })
    );

    expect(response.statusCode).toBe(400);
    expect(creditQueries.addCredits).not.toHaveBeenCalled();
  });

  it('replays a succeeded action instead of repeating it', async () => {
    auditMock.writeAuditLog.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    auditQueries.findAuditByKey.mockResolvedValue({
      status: 'succeeded',
      after: { amount: 10, balanceBefore: 100, balanceAfter: 110 },
    });

    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/users/${USER_ID}/credits`,
        role: 'support',
        headers: { origin: ALLOWED_ORIGIN, 'idempotency-key': 'key-123' },
      })
    );

    expect(response.statusCode).toBe(200);
    expect(body(response).data).toMatchObject({ balanceAfter: 110 });
    expect(creditQueries.addCredits).not.toHaveBeenCalled();
  });

  it('refuses to replay a failed attempt', async () => {
    auditMock.writeAuditLog.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    auditQueries.findAuditByKey.mockResolvedValue({ status: 'failed', after: null });

    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/users/${USER_ID}/credits`,
        role: 'support',
        headers: { origin: ALLOWED_ORIGIN, 'idempotency-key': 'key-456' },
      })
    );

    expect(response.statusCode).toBe(409);
    expect(creditQueries.addCredits).not.toHaveBeenCalled();
  });

  it('409s when the user has no subscription to credit', async () => {
    creditQueries.lockSubscription.mockResolvedValue(null);

    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/users/${USER_ID}/credits`,
        role: 'support',
      })
    );

    expect(response.statusCode).toBe(409);
    expect(auditMock.completeAudit).toHaveBeenCalledWith(
      expect.anything(),
      'audit-id-1',
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('rejects a note without a usable reason', async () => {
    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/users/${USER_ID}/notes`,
        role: 'support',
        body: JSON.stringify({ body: 'no reason given' }),
      })
    );

    expect(response.statusCode).toBe(400);
    expect(auditMock.withAudit).not.toHaveBeenCalled();
  });

  it('404s a note for an unknown user without auditing', async () => {
    userQueries.userExists.mockResolvedValue(false);

    const response = await handler(
      makeEvent({ httpMethod: 'POST', path: `/admin/users/${USER_ID}/notes`, role: 'support' })
    );

    expect(response.statusCode).toBe(404);
    expect(auditMock.withAudit).not.toHaveBeenCalled();
  });

  it('rejects an unsupported dashboard window', async () => {
    const response = await handler(
      makeEvent({ path: '/admin/dashboard/summary', queryStringParameters: { days: '365' } })
    );

    expect(response.statusCode).toBe(400);
    expect(dashboardQueries.getDashboard).not.toHaveBeenCalled();
  });

  it('defaults the dashboard window to 7 days', async () => {
    const response = await handler(makeEvent({ path: '/admin/dashboard/summary' }));

    expect(response.statusCode).toBe(200);
    expect(dashboardQueries.getDashboard).toHaveBeenCalledWith(expect.anything(), 7);
  });

  it('passes the stuck filter through to the schedule query', async () => {
    await handler(
      makeEvent({ path: '/admin/markets/schedule', queryStringParameters: { stuck: 'true', limit: '10' } })
    );

    expect(marketQueries.listSchedules).toHaveBeenCalledWith(
      expect.anything(),
      { status: null, stuckOnly: true },
      10,
      null
    );
  });

  it('returns ops health', async () => {
    const response = await handler(makeEvent({ path: '/admin/ops/health' }));
    const payload = body(response).data as Record<string, unknown>;

    expect(response.statusCode).toBe(200);
    expect(payload).toMatchObject({ windowHours: 24 });
    expect((payload.database as Record<string, unknown>).reachable).toBe(true);
  });

  it('returns agent performance rows', async () => {
    agentQueries.listAgentPerformance.mockResolvedValue([
      { agentName: 'momentum', accuracyPct: 61.2 },
    ]);

    const response = await handler(makeEvent({ path: '/admin/agents/performance' }));
    const payload = body(response).data as Array<Record<string, unknown>>;

    expect(response.statusCode).toBe(200);
    expect(payload).toHaveLength(1);
  });
});

describe('CORS', () => {
  it('echoes an allowed origin', async () => {
    const response = await handler(makeEvent());

    expect(response.headers['Access-Control-Allow-Origin']).toBe(ALLOWED_ORIGIN);
    expect(response.headers.Vary).toBe('Origin');
  });

  it('never echoes a disallowed origin', async () => {
    const response = await handler(makeEvent({ headers: { origin: OTHER_ORIGIN } }));

    expect(response.headers['Access-Control-Allow-Origin']).toBe(ALLOWED_ORIGIN);
  });

  it('applies CORS headers to errors too', async () => {
    const response = await handler(makeEvent({ withAuthorizer: false }));

    expect(response.headers['Access-Control-Allow-Origin']).toBe(ALLOWED_ORIGIN);
  });

  it('marks responses as non-cacheable', async () => {
    const response = await handler(makeEvent());

    expect(response.headers['Cache-Control']).toBe('no-store');
  });
});
