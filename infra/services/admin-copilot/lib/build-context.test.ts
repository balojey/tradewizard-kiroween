import { describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import { buildContext, CopilotError, deriveAuditSearch, MAX_RECORDS } from './build-context';
import type { CopilotRequest } from '../types';

interface QueryResult {
  rows: Record<string, unknown>[];
}

type Responder = (sql: string, params: unknown[]) => QueryResult;

function fakeClient(responder: Responder = () => ({ rows: [] })): {
  client: Client;
  calls: Array<{ sql: string; params: unknown[] }>;
} {
  const calls: Array<{ sql: string; params: unknown[] }> = [];

  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return responder(sql, params);
    }),
  } as unknown as Client;

  return { client, calls };
}

const NOW = new Date('2026-01-01T12:00:00.000Z');

function request(overrides: Partial<CopilotRequest> = {}): CopilotRequest {
  return {
    kind: 'incident',
    question: 'What changed in the last hour?',
    context: { role: 'analyst', actorSub: 'admin-sub' },
    ...overrides,
  } as CopilotRequest;
}

describe('buildContext — incident', () => {
  it('retrieves the audit window and metrics for an analyst', async () => {
    const { client, calls } = fakeClient();

    const context = await buildContext(client, request(), NOW);

    expect(calls.some((call) => call.sql.includes('FROM admin_audit_log'))).toBe(true);
    expect(context.records.map((record) => record.type).sort()).toEqual(['metric', 'metric']);
    expect(context.window).toEqual({
      from: '2026-01-01T11:00:00.000Z',
      to: '2026-01-01T12:00:00.000Z',
    });
  });

  it('binds the search term as a parameter, never interpolates it', async () => {
    const { client, calls } = fakeClient();

    await buildContext(
      client,
      request({
        question: 'what happened to 11111111-1111-4111-8111-111111111111',
      }),
      NOW
    );

    const auditCall = calls.find((call) => call.sql.includes('FROM admin_audit_log'));

    expect(auditCall).toBeDefined();
    expect(auditCall!.sql).not.toContain('11111111-1111-4111-8111-111111111111');
    expect(auditCall!.params).toContain('11111111-1111-4111-8111-111111111111');
  });

  it('rejects a window wider than a week', async () => {
    const { client } = fakeClient();

    await expect(
      buildContext(
        client,
        request({
          context: {
            role: 'analyst',
            actorSub: 'admin-sub',
            from: '2025-12-01T00:00:00.000Z',
            to: '2026-01-01T00:00:00.000Z',
          },
        }),
        NOW
      )
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rejects an inverted window', async () => {
    const { client } = fakeClient();

    await expect(
      buildContext(
        client,
        request({
          context: {
            role: 'analyst',
            actorSub: 'admin-sub',
            from: '2026-01-01T12:00:00.000Z',
            to: '2026-01-01T11:00:00.000Z',
          },
        }),
        NOW
      )
    ).rejects.toBeInstanceOf(CopilotError);
  });
});

describe('buildContext — role scoping', () => {
  it('refuses support tickets to an analyst', async () => {
    const { client } = fakeClient();

    await expect(
      buildContext(
        client,
        request({
          kind: 'support',
          context: {
            role: 'analyst',
            actorSub: 'admin-sub',
            ticketId: '33333333-3333-4333-8333-333333333333',
          },
        }),
        NOW
      )
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('never queries settings for a support role', async () => {
    const { client, calls } = fakeClient();

    await buildContext(
      client,
      request({
        kind: 'risk_brief',
        question: undefined,
        context: {
          role: 'support',
          actorSub: 'admin-sub',
          action: 'settings.update',
          targetType: 'setting',
          targetId: 'analysis_paused',
        },
      }),
      NOW
    );

    expect(calls.some((call) => call.sql.includes('FROM system_settings'))).toBe(false);
  });

  it('queries settings for an admin risk brief', async () => {
    const { client, calls } = fakeClient();

    await buildContext(
      client,
      request({
        kind: 'risk_brief',
        question: undefined,
        context: {
          role: 'admin',
          actorSub: 'admin-sub',
          action: 'settings.update',
          targetType: 'setting',
          targetId: 'analysis_paused',
        },
      }),
      NOW
    );

    expect(calls.some((call) => call.sql.includes('FROM system_settings'))).toBe(true);
  });
});

describe('buildContext — support', () => {
  it('returns the ticket and its requester context', async () => {
    const ticketId = '33333333-3333-4333-8333-333333333333';

    const { client } = fakeClient((sql) => {
      if (sql.includes('FROM support_tickets')) {
        return {
          rows: [
            {
              id: ticketId,
              ref: 'TW-1001',
              requesterEmail: 'customer@example.com',
              userId: '44444444-4444-4444-8444-444444444444',
              topic: 'analysis',
              status: 'open',
              priority: 'normal',
              subject: 'Why NO_TRADE?',
              body: 'Please explain. https://evil.example',
              context: { analysisId: '55555555-5555-4555-8555-555555555555' },
              createdAt: '2026-01-01T10:00:00.000Z',
              lastMessageAt: '2026-01-01T10:00:00.000Z',
              firstResponseAt: null,
              assignedAdminSub: null,
            },
          ],
        };
      }

      if (sql.includes('FROM users u')) {
        return { rows: [{ plan: 'pro', status: 'active', createdAt: '2025-06-01T00:00:00.000Z' }] };
      }

      return { rows: [] };
    });

    const context = await buildContext(
      client,
      request({
        kind: 'support',
        question: undefined,
        context: { role: 'support', actorSub: 'admin-sub', ticketId },
      }),
      NOW
    );

    const ticket = context.records.find((record) => record.type === 'ticket');

    expect(ticket).toBeDefined();
    expect(ticket!.url).toBe(`/support/${ticketId}`);
    expect(ticket!.data).toMatchObject({
      ref: 'TW-1001',
      requesterEmail: 'customer@example.com',
      requester: { plan: 'pro', status: 'active' },
    });
    // Link removed before the text reaches the model.
    expect(JSON.stringify(ticket!.data)).not.toContain('evil.example');
  });

  it('returns NOT_FOUND for a ticket that does not exist', async () => {
    const { client } = fakeClient();

    await expect(
      buildContext(
        client,
        request({
          kind: 'support',
          context: {
            role: 'support',
            actorSub: 'admin-sub',
            ticketId: '33333333-3333-4333-8333-333333333333',
          },
        }),
        NOW
      )
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('buildContext — session', () => {
  it('refuses portfolio sessions to an analyst', async () => {
    const { client } = fakeClient();

    await expect(
      buildContext(
        client,
        request({
          kind: 'session',
          question: undefined,
          context: {
            role: 'analyst',
            actorSub: 'admin-sub',
            sessionId: '66666666-6666-4666-8666-666666666666',
          },
        }),
        NOW
      )
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('returns the session and its linked analysis for support', async () => {
    const sessionId = '66666666-6666-4666-8666-666666666666';
    const analysisId = '22222222-2222-4222-8222-222222222222';

    const { client } = fakeClient((sql) => {
      if (sql.includes('FROM portfolio_manager_sessions')) {
        return {
          rows: [
            {
              id: sessionId,
              userId: '44444444-4444-4444-8444-444444444444',
              userEmail: 'user@example.com',
              marketId: '0xmarket',
              personaId: 'momentum',
              status: 'completed',
              investmentAmount: 100,
              realizedPnl: 12,
              unrealizedPnl: 0,
              totalTrades: 2,
              winningTrades: 1,
              positionDirection: null,
              positionSize: null,
              positionEntryPrice: null,
              terminationReason: null,
              createdAt: '2026-01-01T09:00:00.000Z',
              terminatedAt: null,
              updatedAt: '2026-01-01T10:00:00.000Z',
            },
          ],
        };
      }

      if (sql.includes('FROM portfolio_manager_decisions')) {
        return { rows: [{ id: analysisId }] };
      }

      if (sql.includes('FROM analysis_results')) {
        return {
          rows: [
            {
              id: analysisId,
              marketId: '0xmarket',
              executedAt: '2026-01-01T09:00:00.000Z',
              recommendation: 'LONG_YES',
              consensusProbability: 0.62,
              confidence: 0.7,
              edge: 0.08,
              marketProbability: 0.54,
              outcomeStatus: 'pending',
              noTradeReason: null,
              shadowAction: null,
              shadowProbability: null,
              shadowReason: null,
              payloadKey: 'results/0xmarket/run.json',
            },
          ],
        };
      }

      return { rows: [] };
    });

    const context = await buildContext(
      client,
      request({
        kind: 'session',
        question: undefined,
        context: { role: 'support', actorSub: 'admin-sub', sessionId },
      }),
      NOW
    );

    expect(context.records.some((record) => record.type === 'session')).toBe(true);
    expect(context.records.some((record) => record.type === 'analysis')).toBe(true);
  });
});

describe('buildContext — record budget', () => {
  it('caps records even when the database returns more', async () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      actorEmail: 'ops@example.com',
      actorRole: 'admin',
      action: 'settings.update',
      targetType: 'setting',
      targetId: 'analysis_paused',
      reason: 'x'.repeat(400),
      status: 'succeeded',
      error: null,
      before: { value: false },
      after: { value: true },
      createdAt: '2026-01-01T11:30:00.000Z',
    }));

    const { client } = fakeClient((sql) =>
      sql.includes('FROM admin_audit_log') ? { rows } : { rows: [] }
    );

    const context = await buildContext(client, request(), NOW);

    expect(context.records.length).toBeLessThanOrEqual(MAX_RECORDS);
  });
});

describe('deriveAuditSearch', () => {
  it('extracts a uuid', () => {
    expect(deriveAuditSearch('what happened to 11111111-1111-4111-8111-111111111111')).toBe(
      '11111111-1111-4111-8111-111111111111'
    );
  });

  it('extracts an explicit action prefix', () => {
    expect(deriveAuditSearch('show action: settings.update')).toBe('settings.update');
  });

  it('does not turn a conversation into a filter', () => {
    expect(deriveAuditSearch('What changed in the last hour?')).toBeNull();
  });
});
