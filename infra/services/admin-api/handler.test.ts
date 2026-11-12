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
  inviteLinkQueries,
  supportQueries,
  supportEmailMock,
  supportTokensMock,
  newsletterQueries,
  newsletterEmailMock,
  newsletterRenderMock,
  newsletterTokenMock,
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
    isProductUserByCognitoSub: vi.fn(),
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
    listAuditChain: vi.fn(),
    hasEarlierAuditRow: vi.fn(),
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
    incrementCounter: vi.fn(),
  },
  sqsMock: {
    send: vi.fn(),
  },
  settingsMock: {
    listSettings: vi.fn(),
    setSetting: vi.fn(),
    resetSettingsCacheForTests: vi.fn(),
    warmSettings: vi.fn(),
    getSettingSync: vi.fn(),
    getSetting: vi.fn(),
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
    createInvitedUser: vi.fn(),
    findUserByEmail: vi.fn(),
    getGroupsForUser: vi.fn(),
    addToGroup: vi.fn(),
    removeFromGroup: vi.fn(),
    countOwners: vi.fn(),
    globalSignOut: vi.fn(),
    getUserStatus: vi.fn(),
    disableUser: vi.fn(),
  },
  inviteLinkQueries: {
    createInviteLink: vi.fn(),
    listInviteLinks: vi.fn(),
    findInviteLinkById: vi.fn(),
    findInviteLinkByTokenHash: vi.fn(),
    revokeInviteLink: vi.fn(),
    reserveInviteUse: vi.fn(),
    releaseInviteUse: vi.fn(),
    recordInviteRedemption: vi.fn(),
    listInviteRedemptions: vi.fn(),
  },
  supportQueries: {
    listTickets: vi.fn(),
    getTicketById: vi.fn(),
    lockTicket: vi.fn(),
    listMessages: vi.fn(),
    requesterInfo: vi.fn(),
    claimTicket: vi.fn(),
    releaseTicket: vi.fn(),
    assignTicket: vi.fn(),
    insertAdminMessage: vi.fn(),
    recordReply: vi.fn(),
    updateTicket: vi.fn(),
    summaryCounts: vi.fn(),
    findMessageByRequestId: vi.fn(),
  },
  supportEmailMock: {
    sendSupportReply: vi.fn(),
    sendSupportResolved: vi.fn(),
  },
  supportTokensMock: {
    issueThreadToken: vi.fn(),
  },
  newsletterQueries: {
    listCampaigns: vi.fn(),
    getCampaign: vi.fn(),
    createCampaign: vi.fn(),
    updateCampaign: vi.fn(),
    countAudience: vi.fn(),
    claimCampaign: vi.fn(),
    snapshotRecipients: vi.fn(),
    cancelCampaign: vi.fn(),
    campaignSummary: vi.fn(),
    deliveryBreakdown: vi.fn(),
    listSubscribers: vi.fn(),
  },
  newsletterEmailMock: {
    sendEmail: vi.fn(),
    sendEmailBatch: vi.fn(),
  },
  newsletterRenderMock: {
    renderNewsletter: vi.fn(),
  },
  newsletterTokenMock: {
    createUnsubscribeToken: vi.fn(),
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

vi.mock('../shared/invite-links', () => inviteLinkQueries);

vi.mock('./queries/support', () => supportQueries);
vi.mock('../shared/support-email', () => supportEmailMock);
vi.mock('../shared/support-tickets', () => supportTokensMock);
vi.mock('./queries/newsletter', () => newsletterQueries);
vi.mock('../shared/email', () => newsletterEmailMock);
vi.mock('../shared/newsletter-render', () => newsletterRenderMock);
vi.mock('../shared/newsletter-token', () => newsletterTokenMock);

vi.mock('./lib/s3', () => ({
  presignPayloadUrl: presignMock,
  PAYLOAD_URL_TTL_SECONDS: 60,
}));

import { ROLE_RANK, type AdminRole } from '../shared/admin-auth';
import { handler } from './handler';
import { ROUTES } from './lib/router';
import { computeCompletionHash, computeRowHash } from './lib/audit-chain';
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
  { method: 'GET', path: '/admin/audit/verify', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/audit/export', minimumRole: 'analyst' },
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
  { method: 'GET', path: '/admin/invite-links', minimumRole: 'owner' },
  { method: 'POST', path: '/admin/invite-links', minimumRole: 'owner' },
  { method: 'GET', path: '/admin/invite-links/{id}/redemptions', minimumRole: 'owner' },
  { method: 'DELETE', path: '/admin/invite-links/{id}', minimumRole: 'owner' },
  { method: 'POST', path: '/admin/portfolio/sessions/{id}/terminate', minimumRole: 'admin' },
  { method: 'POST', path: '/admin/analyses/requeue', minimumRole: 'admin' },
  { method: 'GET', path: '/admin/settings', minimumRole: 'admin' },
  { method: 'PUT', path: '/admin/settings/{key}', minimumRole: 'owner' },
  { method: 'GET', path: '/admin/newsletter/summary', minimumRole: 'admin' },
  { method: 'GET', path: '/admin/newsletter/subscribers', minimumRole: 'admin' },
  { method: 'GET', path: '/admin/newsletter/campaigns', minimumRole: 'admin' },
  { method: 'GET', path: '/admin/newsletter/campaigns/{id}', minimumRole: 'admin' },
  { method: 'POST', path: '/admin/newsletter/campaigns', minimumRole: 'admin' },
  { method: 'PUT', path: '/admin/newsletter/campaigns/{id}', minimumRole: 'admin' },
  { method: 'POST', path: '/admin/newsletter/campaigns/{id}/preview', minimumRole: 'admin' },
  { method: 'POST', path: '/admin/newsletter/campaigns/{id}/test', minimumRole: 'admin' },
  { method: 'POST', path: '/admin/newsletter/campaigns/{id}/send', minimumRole: 'owner' },
  { method: 'POST', path: '/admin/newsletter/campaigns/{id}/cancel', minimumRole: 'owner' },
  { method: 'GET', path: '/admin/support/summary', minimumRole: 'support' },
  { method: 'GET', path: '/admin/support/tickets', minimumRole: 'support' },
  { method: 'GET', path: '/admin/support/tickets/{id}', minimumRole: 'support' },
  { method: 'POST', path: '/admin/support/tickets/{id}/claim', minimumRole: 'support' },
  { method: 'POST', path: '/admin/support/tickets/{id}/release', minimumRole: 'support' },
  { method: 'POST', path: '/admin/support/tickets/{id}/messages', minimumRole: 'support' },
  { method: 'PUT', path: '/admin/support/tickets/{id}', minimumRole: 'support' },
  { method: 'GET', path: '/admin/bootstrap/status', minimumRole: 'analyst' },
  { method: 'POST', path: '/admin/bootstrap/mfa-enrolled', minimumRole: 'analyst' },
  { method: 'POST', path: '/admin/copilot/incident', minimumRole: 'analyst' },
  { method: 'GET', path: '/admin/copilot/status', minimumRole: 'analyst' },
  { method: 'POST', path: '/admin/copilot/analysis', minimumRole: 'analyst' },
  { method: 'POST', path: '/admin/copilot/support', minimumRole: 'support' },
  { method: 'POST', path: '/admin/copilot/session', minimumRole: 'support' },
  { method: 'POST', path: '/admin/copilot/risk-brief', minimumRole: 'admin' },
];

const ALL_ROLES: AdminRole[] = ['analyst', 'support', 'admin', 'owner'];

const QUERY_FNS = [
  ...Object.values(userQueries),
  ...Object.values(analysisQueries),
  ...Object.values(portfolioQueries),
  ...Object.values(supportQueries),
  ...Object.values(newsletterQueries),
  ...Object.values(inviteLinkQueries),
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
  const NEWSLETTER_CONTENT = {
    heroTitle: 'Five markets the agents liked',
    intro: 'Three markets moved, one was a miss, and one is still open.',
    picks: [
      {
        question: 'Will the Fed cut rates in December?',
        aiProbability: 68,
        marketProbability: 54,
        read: 'The agents see a stronger case for a cut than the market price implies.',
        url: 'https://tradewizard.live/markets/fed-cut',
      },
    ],
    closing: 'That is the week. Reply to this email if you want a market covered.',
  };
  const bodyFor = (routePath: string): string => {
    if (routePath.endsWith('/credits')) return JSON.stringify({ amount: 10, reason: REASON });
    if (routePath.endsWith('/status')) return JSON.stringify({ status: 'suspended', reason: REASON });
    if (routePath.endsWith('/plan-override'))
      return JSON.stringify({ plan: 'pro', expiresAt: null, reason: REASON });
    if (routePath.includes('/settings/'))
      return JSON.stringify({ value: true, reason: REASON });
    if (routePath.includes('/newsletter/campaigns/{id}/preview')) {
      return JSON.stringify({
        subject: 'Five markets the agents liked',
        template: 'market_brief',
        content: NEWSLETTER_CONTENT,
      });
    }
    if (routePath.endsWith('/newsletter/campaigns')) {
      return JSON.stringify({
        subject: 'Five markets the agents liked',
        template: 'market_brief',
        content: NEWSLETTER_CONTENT,
        reason: REASON,
      });
    }
    if (routePath.endsWith('/newsletter/campaigns/{id}')) {
      return JSON.stringify({
        subject: 'Five markets the agents liked',
        template: 'market_brief',
        content: NEWSLETTER_CONTENT,
        reason: REASON,
      });
    }
    if (routePath.endsWith('/support/tickets/{id}/messages'))
      return JSON.stringify({ body: 'a support reply', internal: false });
    if (routePath.endsWith('/support/tickets/{id}'))
      return JSON.stringify({ status: 'resolved', reason: REASON });
    if (routePath.endsWith('/requeue'))
      return JSON.stringify({ marketId: '0xmarket123', reason: REASON });
    if (routePath.includes('/admins'))
      return JSON.stringify({ email: 'new@example.com', role: 'support', reason: REASON });
    if (routePath === '/admin/invite-links')
      return JSON.stringify({ role: 'support', expiresInHours: 168, maxUses: 5, reason: REASON });
    if (routePath === '/admin/invite-links/{id}')
      return JSON.stringify({ reason: REASON, disableUnclaimed: true });
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
  process.env.NEWSLETTER_SEND_FUNCTION_NAME = 'tw-dev-newsletter-send';
  process.env.COPILOT_FUNCTION_NAME = 'tw-dev-admin-copilot';

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
  userQueries.isProductUserByCognitoSub.mockResolvedValue(false);

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
  auditQueries.listAuditChain.mockResolvedValue([]);
  auditQueries.hasEarlierAuditRow.mockResolvedValue(false);

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

  newsletterQueries.listCampaigns.mockResolvedValue({ items: [], nextCursor: null });
  newsletterQueries.campaignSummary.mockResolvedValue({ drafts: 0, sending: 0, sent: 0, subscribers: 3, unsubscribed: 1, suppressed: 0 });
  newsletterQueries.listSubscribers.mockResolvedValue({ items: [], nextCursor: null });
  newsletterQueries.getCampaign.mockResolvedValue(null);
  newsletterQueries.createCampaign.mockResolvedValue({ id: 'campaign-1', subject: 'Subject' });
  newsletterQueries.updateCampaign.mockResolvedValue({ id: 'campaign-1', subject: 'Subject', template: 'market_brief' });
  newsletterQueries.countAudience.mockResolvedValue(3);
  newsletterQueries.claimCampaign.mockResolvedValue({ id: 'campaign-1', status: 'sending' });
  newsletterQueries.snapshotRecipients.mockResolvedValue(3);
  newsletterQueries.cancelCampaign.mockResolvedValue({ id: 'campaign-1', status: 'cancelled' });
  newsletterQueries.deliveryBreakdown.mockResolvedValue({ queued: 3 });
  newsletterRenderMock.renderNewsletter.mockResolvedValue({ html: '<html></html>', text: 'text' });
  newsletterTokenMock.createUnsubscribeToken.mockResolvedValue('token-1');
  newsletterEmailMock.sendEmail.mockResolvedValue({ provider: 'resend', messageId: 'msg-1' });
  newsletterEmailMock.sendEmailBatch.mockResolvedValue({ provider: 'resend', messageIds: [] });

  supportQueries.listTickets.mockResolvedValue({ items: [], nextCursor: null });
  supportQueries.summaryCounts.mockResolvedValue({ open: 0, pending: 0, unassigned: 0, overdue: 0 });
  supportQueries.getTicketById.mockResolvedValue(null);
  supportQueries.lockTicket.mockResolvedValue(null);
  supportQueries.listMessages.mockResolvedValue([]);
  supportQueries.requesterInfo.mockResolvedValue({ userId: null, status: null, plan: null, createdAt: null });
  supportQueries.claimTicket.mockResolvedValue(true);
  supportQueries.releaseTicket.mockResolvedValue(true);
  supportQueries.assignTicket.mockResolvedValue(undefined);
  supportQueries.insertAdminMessage.mockResolvedValue({
    id: 'message-1',
    authorType: 'admin',
    authorAdminEmail: 'admin@example.com',
    body: 'a support reply',
    isInternal: false,
    createdAt: '2026-11-03T00:00:00.000Z',
  });
  supportQueries.recordReply.mockResolvedValue(undefined);
  supportTokensMock.issueThreadToken.mockResolvedValue('fresh-thread-token');
  supportQueries.updateTicket.mockResolvedValue(undefined);
  supportQueries.findMessageByRequestId.mockResolvedValue(null);
  supportEmailMock.sendSupportReply.mockResolvedValue({ provider: 'resend' });
  supportEmailMock.sendSupportResolved.mockResolvedValue({ provider: 'resend' });

  memberQueries.listMembers.mockResolvedValue([]);
  // Default: nobody has the address. Tests that need an existing identity set
  // their own matcher (the route checks the typed address, then its alias).
  memberQueries.findUserByEmail.mockResolvedValue(null);
  memberQueries.getGroupsForUser.mockResolvedValue([]);
  memberQueries.createInvitedUser.mockResolvedValue({ sub: 'invited-sub', status: 'FORCE_CHANGE_PASSWORD' });
  memberQueries.addToGroup.mockResolvedValue(undefined);
  memberQueries.removeFromGroup.mockResolvedValue(undefined);
  memberQueries.countOwners.mockResolvedValue(2);
  memberQueries.globalSignOut.mockResolvedValue(undefined);
  memberQueries.getUserStatus.mockResolvedValue('FORCE_CHANGE_PASSWORD');
  memberQueries.disableUser.mockResolvedValue(undefined);

  inviteLinkQueries.createInviteLink.mockImplementation(async (_client: unknown, input: Record<string, unknown>) => ({
    ...input,
    useCount: 0,
    revokedAt: null,
    revokedBy: null,
    lastUsedAt: null,
    createdAt: new Date(),
  }));
  inviteLinkQueries.listInviteLinks.mockResolvedValue([]);
  inviteLinkQueries.findInviteLinkById.mockResolvedValue({
    id: USER_ID,
    role: 'support',
    createdBySub: 'sub-1',
    createdByEmail: 'admin@example.com',
    reason: 'matrix test reason',
    expiresAt: new Date(Date.now() + 3_600_000),
    maxUses: 5,
    useCount: 1,
    revokedAt: null,
    revokedBy: null,
    lastUsedAt: null,
    createdAt: new Date(),
  });
  inviteLinkQueries.findInviteLinkByTokenHash.mockResolvedValue(null);
  inviteLinkQueries.revokeInviteLink.mockResolvedValue({
    id: USER_ID,
    role: 'support',
    createdBySub: 'sub-1',
    createdByEmail: 'admin@example.com',
    reason: 'matrix test reason',
    expiresAt: new Date(Date.now() + 3_600_000),
    maxUses: 5,
    useCount: 1,
    revokedAt: new Date(),
    revokedBy: 'admin@example.com',
    lastUsedAt: null,
    createdAt: new Date(),
  });
  inviteLinkQueries.reserveInviteUse.mockResolvedValue(null);
  inviteLinkQueries.releaseInviteUse.mockResolvedValue(undefined);
  inviteLinkQueries.recordInviteRedemption.mockResolvedValue(undefined);
  inviteLinkQueries.listInviteRedemptions.mockResolvedValue([]);

  killSwitchMock.isHalted.mockResolvedValue(false);
  killSwitchMock.activateUser.mockResolvedValue({ active: true, triggeredAt: '2026-11-02T00:00:00.000Z', reason: 'test', ttl: 1 });
  killSwitchMock.resetUser.mockResolvedValue(undefined);
  lambdaMock.send.mockReset();
  lambdaMock.send.mockResolvedValue({
    Payload: Buffer.from(
      JSON.stringify({
        ok: true,
        response: {
          answer: 'ok',
          citations: [],
          suggestedActions: [],
          confidence: 'low',
          limitations: null,
          model: 'test',
          generatedAt: '2026-01-01T00:00:00.000Z',
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
        },
      })
    ),
  });
  orderMock.cancelPendingOrders.mockResolvedValue({ cancelled: 1, releasedUsdc: 25 });

  sqsMock.send.mockReset();
  sqsMock.send.mockResolvedValue({});
  settingsMock.listSettings.mockResolvedValue([]);
  settingsMock.setSetting.mockResolvedValue(undefined);
  settingsMock.warmSettings.mockResolvedValue(undefined);
  settingsMock.getSettingSync.mockReturnValue('24');
  settingsMock.getSetting.mockResolvedValue(true);
  dedupMock.checkInFlight.mockResolvedValue(null);
  dedupMock.markInFlight.mockResolvedValue(undefined);
  dedupMock.clearInFlight.mockResolvedValue(undefined);
  dedupMock.incrementCounter.mockResolvedValue(1);

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
    memberQueries.findUserByEmail.mockImplementation(async (email: string) =>
      email === 'new+warden@example.com'
        ? { sub: 'new-sub', email: 'new+warden@example.com', status: 'CONFIRMED' }
        : null
    );

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
    expect(body(response).data).toMatchObject({ sub: 'new-sub', role: 'support', aliased: true });
  });

  it('refuses to attach a group to a customer account', async () => {
    memberQueries.findUserByEmail.mockImplementation(async (email: string) =>
      email === 'customer@example.com'
        ? { sub: 'customer-sub', email: 'customer@example.com', status: 'CONFIRMED' }
        : null
    );
    memberQueries.getGroupsForUser.mockResolvedValue([]);
    userQueries.isProductUserByCognitoSub.mockResolvedValue(true);

    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: '/admin/admins',
        role: 'owner',
        body: JSON.stringify({
          email: 'customer@example.com',
          role: 'support',
          reason: 'wants portal access',
        }),
      })
    );

    // The 2026-11-03 incident: this used to succeed and break product login.
    expect(response.statusCode).toBe(409);
    expect(memberQueries.addToGroup).not.toHaveBeenCalled();
    expect(body(response).error).toMatchObject({
      code: 'CONFLICT',
      details: { adminEmail: 'customer+warden@example.com' },
    });
  });

  it('refuses to create an account unless the caller confirms the invite', async () => {
    memberQueries.findUserByEmail.mockResolvedValue(null);

    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: '/admin/admins',
        role: 'owner',
        body: JSON.stringify({ email: 'typo@example.com', role: 'support', reason: 'typo in address' }),
      })
    );

    // A mistyped address must not silently create someone's account.
    expect(response.statusCode).toBe(404);
    expect(memberQueries.createInvitedUser).not.toHaveBeenCalled();
  });

  it('invites an account that does not exist yet', async () => {
    memberQueries.findUserByEmail.mockResolvedValue(null);

    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: '/admin/admins',
        role: 'owner',
        body: JSON.stringify({
          email: 'new-admin@example.com',
          role: 'admin',
          reason: 'inviting the new operator',
          invite: true,
        }),
      })
    );

    expect(response.statusCode).toBe(201);
    expect(memberQueries.createInvitedUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'new-admin+warden@example.com',
        temporaryPassword: expect.any(String),
      })
    );
    expect(newsletterEmailMock.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'new-admin+warden@example.com' })
    );
    expect(memberQueries.addToGroup).toHaveBeenCalledWith('invited-sub', 'tw-admin');
    expect(body(response).data).toMatchObject({
      invited: true,
      role: 'admin',
      adminEmail: 'new-admin+warden@example.com',
      aliased: true,
      emailSent: true,
    });
  });

  it('refuses to add someone who is already a member', async () => {
    memberQueries.findUserByEmail.mockResolvedValue({
      sub: 'existing-sub',
      email: 'new@example.com',
      status: 'CONFIRMED',
    });
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

  it('records an MFA enrolment only when the factor exists', async () => {
    const enrolled = await handler(
      makeEvent({ httpMethod: 'POST', path: '/admin/bootstrap/mfa-enrolled', role: 'support' })
    );
    expect(enrolled.statusCode).toBe(200);
    expect(auditMock.writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'admin.mfa.enrolled', targetId: 'sub-1' })
    );

    // Same route, token without a factor: the authorizer reports mfa:false.
    const event = makeEvent({
      httpMethod: 'POST',
      path: '/admin/bootstrap/mfa-enrolled',
      role: 'support',
    });
    event.requestContext!.authorizer!.mfa = false;

    const denied = await handler(event);
    expect(denied.statusCode).toBe(409);
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

  it('mints an invite link once and never stores the token', async () => {
    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: '/admin/invite-links',
        role: 'owner',
        body: JSON.stringify({
          role: 'analyst',
          expiresInHours: 24,
          maxUses: 3,
          reason: 'sharing with the research team',
        }),
      })
    );

    expect(response.statusCode).toBe(201);
    const data = body(response).data as { url: string; role: string };
    expect(data.role).toBe('analyst');
    expect(data.url).toMatch(/\/join#t=[A-Za-z0-9_-]{43}$/);

    // Only a hash reaches the database, and the audit row carries no token.
    const stored = inviteLinkQueries.createInviteLink.mock.calls[0][1] as {
      tokenHash: string;
    };
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(auditMock.writeAuditLog.mock.calls)).not.toContain('#t=');
    expect(JSON.stringify(auditMock.completeAudit.mock.calls)).not.toContain('#t=');
  });

  it('accepts a 365-day lifetime and rejects a longer one', async () => {
    const accepted = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: '/admin/invite-links',
        role: 'owner',
        body: JSON.stringify({
          role: 'analyst',
          expiresInHours: 8760,
          maxUses: 1,
          reason: 'long-lived link for the research team',
        }),
      })
    );
    expect(accepted.statusCode).toBe(201);

    const rejected = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: '/admin/invite-links',
        role: 'owner',
        body: JSON.stringify({
          role: 'analyst',
          expiresInHours: 8761,
          maxUses: 1,
          reason: 'longer than a year',
        }),
      })
    );
    expect(rejected.statusCode).toBe(400);
  });

  it('revokes an invite link and disables accounts that never signed in', async () => {
    inviteLinkQueries.listInviteRedemptions.mockResolvedValue([
      { id: 'r1', linkId: USER_ID, cognitoSub: 'sub-unclaimed', email: 'a+warden@example.com', createdAt: new Date() },
      { id: 'r2', linkId: USER_ID, cognitoSub: 'sub-active', email: 'b+warden@example.com', createdAt: new Date() },
    ]);
    memberQueries.getUserStatus
      .mockResolvedValueOnce('FORCE_CHANGE_PASSWORD')
      .mockResolvedValueOnce('CONFIRMED');

    const response = await handler(
      makeEvent({
        httpMethod: 'DELETE',
        path: `/admin/invite-links/${USER_ID}`,
        role: 'owner',
        body: JSON.stringify({ reason: 'link was shared too widely', disableUnclaimed: true }),
      })
    );

    expect(response.statusCode).toBe(200);
    expect(inviteLinkQueries.revokeInviteLink).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      'admin@example.com'
    );
    expect(memberQueries.disableUser).toHaveBeenCalledTimes(1);
    expect(memberQueries.disableUser).toHaveBeenCalledWith('sub-unclaimed');
    expect(body(response).data).toMatchObject({ revoked: true, disabled: 1 });
  });

  it('reports an already-revoked link as a conflict', async () => {
    inviteLinkQueries.findInviteLinkById.mockResolvedValue({
      id: USER_ID,
      role: 'support',
      createdBySub: 'sub-1',
      createdByEmail: 'admin@example.com',
      reason: 'old link',
      expiresAt: new Date(Date.now() + 3_600_000),
      maxUses: 5,
      useCount: 1,
      revokedAt: new Date(),
      revokedBy: 'admin@example.com',
      lastUsedAt: null,
      createdAt: new Date(),
    });

    const response = await handler(
      makeEvent({
        httpMethod: 'DELETE',
        path: `/admin/invite-links/${USER_ID}`,
        role: 'owner',
        body: JSON.stringify({ reason: 'revoking a second time' }),
      })
    );

    expect(response.statusCode).toBe(409);
    expect(inviteLinkQueries.revokeInviteLink).not.toHaveBeenCalled();
  });

  it('rejects a malformed invite link id before touching the database', async () => {
    const response = await handler(
      makeEvent({
        httpMethod: 'DELETE',
        path: '/admin/invite-links/not-a-uuid',
        role: 'owner',
        body: JSON.stringify({ reason: 'bad id on purpose' }),
      })
    );

    expect(response.statusCode).toBe(400);
    expect(inviteLinkQueries.findInviteLinkById).not.toHaveBeenCalled();
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
  process.env.NEWSLETTER_SEND_FUNCTION_NAME = 'tw-dev-newsletter-send';

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
  process.env.NEWSLETTER_SEND_FUNCTION_NAME = 'tw-dev-newsletter-send';
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

describe('audit chain', () => {
  function rawRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: '00000000-0000-0000-0000-000000000001',
      actorSub: 'sub-1',
      actorEmail: 'admin@example.com',
      actorRole: 'admin',
      action: 'user.note.create',
      targetType: 'user',
      targetId: USER_ID,
      reason: 'matrix test reason',
      status: 'pending',
      before: null,
      after: null,
      error: null,
      createdAt: new Date('2026-11-02T10:00:00.000Z'),
      completedAt: null,
      prevHash: null,
      rowHash: null,
      completionHash: null,
      hashVersion: 1,
      ...overrides,
    };
  }

  function seal(row: Record<string, unknown>): Record<string, unknown> {
    const rowHash = computeRowHash({
      id: String(row.id),
      actorSub: String(row.actorSub),
      actorEmail: String(row.actorEmail),
      actorRole: String(row.actorRole),
      action: String(row.action),
      targetType: String(row.targetType),
      targetId: (row.targetId as string | null) ?? null,
      reason: String(row.reason),
      before: row.before ?? null,
      createdAt: (row.createdAt as Date).toISOString(),
      prevHash: (row.prevHash as string | null) ?? null,
      hashVersion: row.hashVersion as number,
    });

    const sealed: Record<string, unknown> = { ...row, rowHash };

    if (row.status !== 'pending') {
      sealed.completionHash = computeCompletionHash({
        rowHash,
        status: row.status as 'succeeded' | 'failed',
        after: row.after ?? null,
        error: (row.error as string | null) ?? null,
        completedAt: (row.completedAt as Date).toISOString(),
      });
    }

    return sealed;
  }

  it('returns a verified result with the checked range and head', async () => {
    const genesis = seal(rawRow());
    const second = seal(
      rawRow({
        id: '00000000-0000-0000-0000-000000000002',
        createdAt: new Date('2026-11-02T10:00:01.000Z'),
        prevHash: genesis.rowHash,
        status: 'succeeded',
        after: { noteId: 'note-1' },
        completedAt: new Date('2026-11-02T10:00:02.000Z'),
      })
    );
    auditQueries.listAuditChain.mockResolvedValue([genesis, second]);

    const response = await handler(makeEvent({ path: '/admin/audit/verify' }));
    const payload = body(response).data as Record<string, unknown>;

    expect(response.statusCode).toBe(200);
    expect(payload).toMatchObject({
      valid: true,
      checked: 2,
      firstBrokenId: null,
      firstBrokenReason: null,
      coversGenesis: true,
      from: '2026-11-02T10:00:00.000Z',
      to: '2026-11-02T10:00:01.000Z',
      head: `sha256:${second.rowHash}`,
    });
    expect(payload.verifiedAt).toEqual(expect.any(String));
  });

  it('answers 200 with the first broken row instead of a server error', async () => {
    const genesis = seal(rawRow());
    // The stored hash no longer matches the row: the database was edited.
    const tampered = {
      ...seal(
        rawRow({
          id: '00000000-0000-0000-0000-000000000002',
          createdAt: new Date('2026-11-02T10:00:01.000Z'),
          prevHash: genesis.rowHash,
        })
      ),
      reason: 'a reason nobody typed',
    };
    auditQueries.listAuditChain.mockResolvedValue([genesis, tampered]);

    const response = await handler(makeEvent({ path: '/admin/audit/verify' }));
    const payload = body(response).data as Record<string, unknown>;

    expect(response.statusCode).toBe(200);
    expect(payload).toMatchObject({
      valid: false,
      checked: 2,
      firstBrokenId: '00000000-0000-0000-0000-000000000002',
      firstBrokenReason: 'row_hash_mismatch',
    });
  });

  it('defaults to 1000 rows and clamps the window to 5000', async () => {
    await handler(makeEvent({ path: '/admin/audit/verify' }));
    await handler(makeEvent({ path: '/admin/audit/verify', queryStringParameters: { limit: '9999' } }));

    expect(auditQueries.listAuditChain).toHaveBeenNthCalledWith(1, expect.anything(), {
      from: null,
      to: null,
      limit: 1000,
    });
    expect(auditQueries.listAuditChain).toHaveBeenNthCalledWith(2, expect.anything(), {
      from: null,
      to: null,
      limit: 5000,
    });
  });

  it('rejects a non-numeric limit before touching the database', async () => {
    const response = await handler(
      makeEvent({ path: '/admin/audit/verify', queryStringParameters: { limit: 'all' } })
    );

    expect(response.statusCode).toBe(400);
    expect(auditQueries.listAuditChain).not.toHaveBeenCalled();
  });

  it('passes from/to through as ISO timestamps', async () => {
    await handler(
      makeEvent({
        path: '/admin/audit/verify',
        queryStringParameters: { from: '2026-10-01', to: '2026-10-08' },
      })
    );

    expect(auditQueries.listAuditChain).toHaveBeenCalledWith(expect.anything(), {
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-08T00:00:00.000Z',
      limit: 1000,
    });
  });

  it('does not treat a mid-chain window as a broken genesis link', async () => {
    auditQueries.hasEarlierAuditRow.mockResolvedValue(true);
    auditQueries.listAuditChain.mockResolvedValue([
      seal(
        rawRow({
          prevHash: 'f'.repeat(64),
          createdAt: new Date('2026-11-02T10:00:00.000Z'),
        })
      ),
    ]);

    const response = await handler(makeEvent({ path: '/admin/audit/verify' }));
    const payload = body(response).data as Record<string, unknown>;

    expect(payload).toMatchObject({ valid: true, checked: 1, coversGenesis: false });
  });

  it('exports a capped page and says when it truncated', async () => {
    const rows = Array.from({ length: 5001 }, (_, index) =>
      rawRow({ id: `00000000-0000-0000-0000-${String(index).padStart(12, '0')}` })
    );
    auditQueries.listAuditEntries.mockResolvedValue(rows);

    const response = await handler(
      makeEvent({
        path: '/admin/audit/export',
        queryStringParameters: { action: 'user.note.create', status: 'succeeded' },
      })
    );
    const payload = body(response).data as {
      rows: unknown[];
      truncated: boolean;
      cappedAt: number;
    };

    expect(response.statusCode).toBe(200);
    expect(payload.rows).toHaveLength(5000);
    expect(payload.truncated).toBe(true);
    expect(payload.cappedAt).toBe(5000);
    expect(auditQueries.listAuditEntries).toHaveBeenCalledWith(
      expect.anything(),
      {
        actor: null,
        action: 'user.note.create',
        targetType: null,
        targetId: null,
        status: 'succeeded',
        from: null,
        to: null,
        id: null,
      },
      5000,
      null
    );
  });

  it('returns the chain hashes with the audit list', async () => {
    auditQueries.listAuditEntries.mockResolvedValue([
      seal(rawRow({ status: 'succeeded', completedAt: new Date('2026-11-02T10:00:02.000Z') })),
    ]);

    const response = await handler(makeEvent({ path: '/admin/audit' }));
    const payload = body(response) as { data: Array<Record<string, unknown>> };

    expect(payload.data[0]).toMatchObject({
      rowHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      hashVersion: 1,
      completionHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
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

// ─── Support inbox ────────────────────────────────────────────────────────────

function supportTicket(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    ref: 'TW-4F2K9Q',
    subject: 'Wrong recommendation',
    status: 'open',
    priority: 'normal',
    topic: 'analysis',
    requesterEmail: 'person@example.com',
    assignedAdminSub: null,
    createdAt: '2026-11-03T10:00:00.000Z',
    lastMessageAt: '2026-11-03T10:00:00.000Z',
    firstResponseAt: null,
    overdue: false,
    marketId: '0xmarket',
    body: 'The analysis recommends BUY YES but the market resolved NO.',
    context: { marketId: '0xmarket' },
    userId: null,
    assignedAt: null,
    confirmationSent: true,
    lastCustomerNotifiedAt: null,
    resolvedAt: null,
    closedAt: null,
    ...overrides,
  };
}

function runAuditWork(): void {
  auditMock.withAudit.mockImplementation(
    async (
      _client: unknown,
      _params: unknown,
      work: (auditId: string) => Promise<{ result: unknown }>
    ) => (await work('audit-1')).result
  );
}

describe('support inbox', () => {
  it('refuses a second claim and names the current holder', async () => {
    runAuditWork();
    supportQueries.getTicketById.mockResolvedValue(
      supportTicket({ assignedAdminSub: 'other-sub' })
    );
    supportQueries.claimTicket.mockResolvedValue(false);

    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/support/tickets/${USER_ID}/claim`,
        role: 'support',
      })
    );

    expect(response.statusCode).toBe(409);
    expect(body(response).error).toMatchObject({
      code: 'ALREADY_CLAIMED',
      details: { assignedAdminSub: 'other-sub' },
    });
  });

  it('refuses a reply to a ticket held by another operator', async () => {
    supportQueries.lockTicket.mockResolvedValue(
      supportTicket({ assignedAdminSub: 'other-sub' })
    );

    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/support/tickets/${USER_ID}/messages`,
        role: 'support',
        body: JSON.stringify({ body: 'Let me help with this.' }),
      })
    );

    expect(response.statusCode).toBe(409);
    expect(body(response).error).toMatchObject({ code: 'NOT_YOURS' });
    expect(supportQueries.insertAdminMessage).not.toHaveBeenCalled();
  });

  it('claims an unassigned ticket on first reply and emails the customer', async () => {
    runAuditWork();
    supportQueries.lockTicket.mockResolvedValue(supportTicket());
    supportQueries.getTicketById.mockResolvedValue(supportTicket());

    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/support/tickets/${USER_ID}/messages`,
        role: 'support',
        body: JSON.stringify({ body: 'Looking into this now.' }),
      })
    );

    expect(response.statusCode).toBe(201);
    expect(supportEmailMock.sendSupportReply).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'TW-4F2K9Q', to: 'person@example.com' })
    );
    expect(supportTokensMock.issueThreadToken).toHaveBeenCalledWith(expect.anything(), USER_ID);
    expect(supportQueries.claimTicket).toHaveBeenCalledWith(expect.anything(), USER_ID, 'sub-1');
    expect(supportQueries.recordReply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ emailed: true, internal: false })
    );
  });

  it('stores a second reply inside a minute without emailing again', async () => {
    runAuditWork();
    supportQueries.lockTicket.mockResolvedValue(
      supportTicket({ lastCustomerNotifiedAt: new Date().toISOString() })
    );

    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/support/tickets/${USER_ID}/messages`,
        role: 'support',
        body: JSON.stringify({ body: 'Correction: I meant the other run.' }),
      })
    );

    expect(response.statusCode).toBe(201);
    expect((body(response) as { data: unknown }).data).toMatchObject({
      emailSent: false,
      suppressed: true,
    });
    expect(supportEmailMock.sendSupportReply).not.toHaveBeenCalled();
    // No new email means the customer's existing link must keep working.
    expect(supportTokensMock.issueThreadToken).not.toHaveBeenCalled();
  });

  it('never emails an internal note', async () => {
    runAuditWork();
    supportQueries.lockTicket.mockResolvedValue(supportTicket());

    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/support/tickets/${USER_ID}/messages`,
        role: 'support',
        body: JSON.stringify({ body: 'Checking the S3 payload first.', internal: true }),
      })
    );

    expect(response.statusCode).toBe(201);
    expect(supportEmailMock.sendSupportReply).not.toHaveBeenCalled();
    expect(supportTokensMock.issueThreadToken).not.toHaveBeenCalled();
    expect(supportQueries.recordReply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ internal: true, emailed: false })
    );
  });

  it('requires a reason to change status', async () => {
    const response = await handler(
      makeEvent({
        httpMethod: 'PUT',
        path: `/admin/support/tickets/${USER_ID}`,
        role: 'support',
        body: JSON.stringify({ status: 'resolved' }),
      })
    );

    expect(response.statusCode).toBe(400);
    expect(body(response).error).toMatchObject({ code: 'BAD_REQUEST' });
    expect(supportQueries.updateTicket).not.toHaveBeenCalled();
  });

  it('emails the customer when a ticket is resolved', async () => {
    runAuditWork();
    supportQueries.getTicketById.mockResolvedValue(supportTicket({ status: 'resolved' }));

    const response = await handler(
      makeEvent({
        httpMethod: 'PUT',
        path: `/admin/support/tickets/${USER_ID}`,
        role: 'support',
        body: JSON.stringify({ status: 'resolved', reason: 'answered the question' }),
      })
    );

    expect(response.statusCode).toBe(200);
    expect(supportEmailMock.sendSupportResolved).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'TW-4F2K9Q', to: 'person@example.com' })
    );
  });

  it('only lets admins reassign a ticket', async () => {
    const response = await handler(
      makeEvent({
        httpMethod: 'PUT',
        path: `/admin/support/tickets/${USER_ID}`,
        role: 'support',
        body: JSON.stringify({
          assignedAdminSub: 'someone-else',
          reason: 'handing this over to a colleague',
        }),
      })
    );

    expect(response.statusCode).toBe(403);
    expect(supportQueries.updateTicket).not.toHaveBeenCalled();
  });
});

// ─── Newsletter campaigns ────────────────────────────────────────────────────

function validNewsletterContent() {
  return {
    heroTitle: 'Five markets the agents liked',
    intro: 'Three markets moved, one was a miss, and one is still open.',
    picks: [
      {
        question: 'Will the Fed cut rates in December?',
        aiProbability: 68,
        marketProbability: 54,
        read: 'The agents see a stronger case for a cut than the market price implies.',
        url: 'https://tradewizard.live/markets/fed-cut',
      },
    ],
    closing: 'That is the week.',
  };
}

function campaignFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    subject: 'Five markets the agents liked',
    preheader: 'What moved this week',
    template: 'market_brief',
    content: validNewsletterContent(),
    status: 'draft',
    recipientCount: 3,
    sentCount: 0,
    failedCount: 0,
    createdBy: 'admin@example.com',
    createdAt: '2026-11-04T00:00:00.000Z',
    ...overrides,
  };
}

describe('newsletter campaigns', () => {
  it('rejects content the renderer would refuse', async () => {
    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: '/admin/newsletter/campaigns',
        role: 'admin',
        body: JSON.stringify({
          subject: 'Subject line',
          template: 'market_brief',
          reason: 'drafting the weekly issue',
          content: { heroTitle: 'x', intro: '', picks: [] },
        }),
      })
    );

    expect(response.statusCode).toBe(400);
    expect(newsletterQueries.createCampaign).not.toHaveBeenCalled();
  });

  it('refuses to send with no confirmed subscribers', async () => {
    newsletterQueries.countAudience.mockResolvedValue(0);

    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/newsletter/campaigns/${USER_ID}/send`,
        role: 'owner',
        body: JSON.stringify({ reason: 'sending the first issue' }),
      })
    );

    expect(response.statusCode).toBe(409);
    expect(newsletterQueries.claimCampaign).not.toHaveBeenCalled();
  });

  it('claims the campaign and dispatches the sender', async () => {
    runAuditWork();
    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/newsletter/campaigns/${USER_ID}/send`,
        role: 'owner',
        body: JSON.stringify({ reason: 'sending the first issue' }),
      })
    );

    expect(response.statusCode).toBe(202);
    expect(newsletterQueries.claimCampaign).toHaveBeenCalled();
    expect(newsletterQueries.snapshotRecipients).toHaveBeenCalled();
    expect(lambdaMock.send).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ InvocationType: 'Event' }) })
    );
    expect((body(response) as { data: unknown }).data).toMatchObject({ recipients: 3 });
  });

  it('refuses a second send of an already-claimed campaign', async () => {
    runAuditWork();
    newsletterQueries.claimCampaign.mockResolvedValue(null);

    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/newsletter/campaigns/${USER_ID}/send`,
        role: 'owner',
        body: JSON.stringify({ reason: 'trying to send twice' }),
      })
    );

    expect(response.statusCode).toBe(409);
    expect(lambdaMock.send).not.toHaveBeenCalled();
  });

  it('previews unsaved content through the production renderer', async () => {
    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/newsletter/campaigns/${USER_ID}/preview`,
        role: 'admin',
        body: JSON.stringify({
          subject: 'Draft subject',
          template: 'market_brief',
          content: validNewsletterContent(),
        }),
      })
    );

    expect(response.statusCode).toBe(200);
    expect(newsletterRenderMock.renderNewsletter).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'Draft subject' })
    );
  });

  it('sends a test from the newsletter address, only to the operator', async () => {
    runAuditWork();
    newsletterQueries.getCampaign.mockResolvedValue(campaignFixture());

    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/newsletter/campaigns/${USER_ID}/test`,
        role: 'admin',
      })
    );

    expect(response.statusCode).toBe(200);
    expect(newsletterEmailMock.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'admin@example.com',
        from: 'news@tradewizard.live',
        subject: '[TEST] Five markets the agents liked',
      })
    );
  });

  it('only lets an owner send', async () => {
    const response = await handler(
      makeEvent({
        httpMethod: 'POST',
        path: `/admin/newsletter/campaigns/${USER_ID}/send`,
        role: 'admin',
        body: JSON.stringify({ reason: 'admin attempts to send' }),
      })
    );

    expect(response.statusCode).toBe(403);
    expect(newsletterQueries.claimCampaign).not.toHaveBeenCalled();
  });
});


describe('newsletter subscribers', () => {
  it('lists subscribers with suppression state', async () => {
    newsletterQueries.listSubscribers.mockResolvedValue({
      items: [
        {
          email: 'person@example.com',
          status: 'subscribed',
          source: 'signup_prompt',
          userId: USER_ID,
          confirmedAt: '2026-11-04T00:00:00.000Z',
          unsubscribedAt: null,
          suppressedReason: null,
          createdAt: '2026-11-04T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    });

    const response = await handler(
      makeEvent({
        httpMethod: 'GET',
        path: '/admin/newsletter/subscribers',
        role: 'admin',
      })
    );

    expect(response.statusCode).toBe(200);
    expect(newsletterQueries.listSubscribers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: undefined }),
      expect.anything()
    );
    expect((body(response) as { data: unknown }).data).toHaveLength(1);
  });

  it('passes the status filter through', async () => {
    const response = await handler(
      makeEvent({
        httpMethod: 'GET',
        path: '/admin/newsletter/subscribers',
        role: 'admin',
        queryStringParameters: { status: 'unsubscribed' },
      })
    );

    expect(response.statusCode).toBe(200);
    expect(newsletterQueries.listSubscribers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'unsubscribed' }),
      expect.anything()
    );
  });
});
