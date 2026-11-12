import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSettingMock, rateLimitMock, lambdaSendMock } = vi.hoisted(() => ({
  getSettingMock: vi.fn(),
  rateLimitMock: vi.fn(),
  lambdaSendMock: vi.fn(),
}));

vi.mock('../../shared/settings', () => ({
  getSetting: getSettingMock,
}));

vi.mock('../lib/rate-limit', () => ({
  enforceCopilotRateLimit: rateLimitMock,
}));

vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: class {
    send = lambdaSendMock;
  },
  InvokeCommand: class {
    constructor(public input: unknown) {}
  },
}));

import { copilotRoutes } from './copilot';
import type { AdminIdentity } from '../../shared/admin-auth';
import type { AdminApiEvent } from '../lib/types';

const identity: AdminIdentity = {
  sub: 'sub-1',
  email: 'ops@example.com',
  role: 'admin',
  roleRank: 30,
  mfa: true,
  authTime: Math.floor(Date.now() / 1000),
};

function event(path: string, body: unknown): AdminApiEvent {
  return {
    httpMethod: 'POST',
    path,
    headers: { origin: 'http://localhost:3001' },
    body: JSON.stringify(body),
    requestContext: { requestId: 'req-1' },
  };
}

function route(path: string) {
  const found = copilotRoutes.find((candidate) => candidate.path === path);
  if (!found) throw new Error(`Missing route ${path}`);
  return found;
}

const response = {
  answer: 'A change happened.',
  citations: [],
  suggestedActions: [],
  confidence: 'low' as const,
  limitations: null,
  model: 'test',
  generatedAt: '2026-01-01T00:00:00.000Z',
  usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
};

describe('copilot routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettingMock.mockReset();
    rateLimitMock.mockReset();
    lambdaSendMock.mockReset();
    rateLimitMock.mockResolvedValue(undefined);
    process.env.COPILOT_FUNCTION_NAME = 'tw-dev-admin-copilot';
  });

  it('declares the documented minimum roles', () => {
    expect(route('/admin/copilot/incident').minimumRole).toBe('analyst');
    expect(route('/admin/copilot/support').minimumRole).toBe('support');
    expect(route('/admin/copilot/analysis').minimumRole).toBe('analyst');
    expect(route('/admin/copilot/risk-brief').minimumRole).toBe('admin');
  });

  it('returns 503 when copilot_enabled is false', async () => {
    getSettingMock.mockResolvedValue(false);

    await expect(
      route('/admin/copilot/incident').handler({
        event: event('/admin/copilot/incident', { question: 'What changed?' }),
        identity,
        params: {},
      })
    ).rejects.toMatchObject({ statusCode: 503, code: 'COPILOT_DISABLED' });

    expect(lambdaSendMock).not.toHaveBeenCalled();
  });

  it('returns 429 when the per-actor budget is exhausted', async () => {
    getSettingMock.mockResolvedValue(true);
    rateLimitMock.mockRejectedValue(
      Object.assign(new Error('Too many questions'), { statusCode: 429, code: 'RATE_LIMITED' })
    );

    await expect(
      route('/admin/copilot/incident').handler({
        event: event('/admin/copilot/incident', { question: 'What changed?' }),
        identity,
        params: {},
      })
    ).rejects.toMatchObject({ statusCode: 429 });

    expect(lambdaSendMock).not.toHaveBeenCalled();
  });

  it('returns the typed envelope from the copilot function', async () => {
    getSettingMock.mockResolvedValue(true);
    lambdaSendMock.mockResolvedValue({
      Payload: Buffer.from(JSON.stringify({ ok: true, response })),
    });

    const result = await route('/admin/copilot/incident').handler({
      event: event('/admin/copilot/incident', { question: 'What changed?' }),
      identity,
      params: {},
    });

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ data: response });
  });

  it('validates the body before invoking the model', async () => {
    getSettingMock.mockResolvedValue(true);

    await expect(
      route('/admin/copilot/support').handler({
        event: event('/admin/copilot/support', { ticketId: 'not-a-uuid', mode: 'summary' }),
        identity,
        params: {},
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(lambdaSendMock).not.toHaveBeenCalled();
  });

  it('forwards the support mode so the copilot writes a reply, not a summary', async () => {
    getSettingMock.mockResolvedValue(true);
    lambdaSendMock.mockResolvedValue({
      Payload: Buffer.from(JSON.stringify({ ok: true, response })),
    });

    await route('/admin/copilot/support').handler({
      event: event('/admin/copilot/support', {
        ticketId: '33333333-3333-4333-8333-333333333333',
        mode: 'draft_reply',
      }),
      identity: { ...identity, role: 'support', roleRank: 20 },
      params: {},
    });

    const command = lambdaSendMock.mock.calls[0][0] as { input: { Payload: string } };
    const payload = JSON.parse(command.input.Payload) as {
      mode?: string;
      question?: string;
    };

    expect(payload.mode).toBe('draft_reply');
    expect(payload.question).toBe('Write the reply to this ticket.');
  });

  it('maps a copilot error envelope to its HTTP status', async () => {
    getSettingMock.mockResolvedValue(true);
    lambdaSendMock.mockResolvedValue({
      Payload: Buffer.from(
        JSON.stringify({ ok: false, code: 'NOT_FOUND', message: 'That ticket does not exist.' })
      ),
    });

    await expect(
      route('/admin/copilot/support').handler({
        event: event('/admin/copilot/support', {
          ticketId: '33333333-3333-4333-8333-333333333333',
          mode: 'summary',
        }),
        identity: { ...identity, role: 'support', roleRank: 20 },
        params: {},
      })
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });

  it('surfaces an invoke failure as 502 rather than a 500', async () => {
    getSettingMock.mockResolvedValue(true);
    lambdaSendMock.mockResolvedValue({ FunctionError: 'Unhandled' });

    await expect(
      route('/admin/copilot/analysis').handler({
        event: event('/admin/copilot/analysis', {
          analysisId: '22222222-2222-4222-8222-222222222222',
        }),
        identity,
        params: {},
      })
    ).rejects.toMatchObject({ statusCode: 502, code: 'UPSTREAM_FAILED' });
  });
});
