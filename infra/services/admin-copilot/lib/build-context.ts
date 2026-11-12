/**
 * Context assembly.
 *
 * One place decides what a surface may retrieve, how wide the window is, and
 * how much of it reaches the model. Retrieval modules cannot widen this: they
 * receive a role and a bound, and every source is gated by `canRead`.
 *
 * The bundle is trimmed to a character budget *before* the prompt is built, so
 * a busy hour cannot silently blow the model's context (and the bill).
 *
 * See docs/plans/warden-ai-copilot.md §5 and §9.
 */

import type { Client } from 'pg';
import type { AdminRole } from '../../shared/admin-auth';
import { canRead } from './scope';
import { retrieveAudit } from './retrieve-audit';
import { retrieveSupport } from './retrieve-support';
import { retrieveAnalysis } from './retrieve-analysis';
import { retrieveSession } from './retrieve-session';
import { retrieveSettings } from './retrieve-settings';
import { retrieveMetrics } from './retrieve-metrics';
import { retrieveRunbook } from './retrieve-runbook';
import { retrieveImpact } from './retrieve-impact';
import type { CopilotErrorCode, CopilotRequest, RetrievedRecord } from '../types';

/** Bounds that apply to every surface. */
export const MAX_CONTEXT_CHARS = 48_000;
export const MAX_RECORDS = 60;
const MAX_WINDOW_MS = 7 * 24 * 3_600_000;
const DEFAULT_INCIDENT_WINDOW_MS = 3_600_000;

export class CopilotError extends Error {
  constructor(
    public readonly code: CopilotErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'CopilotError';
  }
}

export interface ContextBundle {
  question: string;
  role: AdminRole;
  window: { from: string; to: string };
  records: RetrievedRecord[];
}

export async function buildContext(
  client: Client,
  request: CopilotRequest,
  now = new Date()
): Promise<ContextBundle> {
  const role = request.context.role;
  const question = normalizeQuestion(request.question);
  const window = resolveWindow(request, now);
  const records: RetrievedRecord[] = [];

  if (!canRead(role, 'audit')) {
    throw new CopilotError('FORBIDDEN', 'This role cannot read the audit log.');
  }

  switch (request.kind) {
    case 'incident': {
      const [audit, metrics] = await Promise.all([
        retrieveAudit(client, {
          role,
          from: window.from,
          to: window.to,
          search: deriveAuditSearch(question),
          targetType: request.context.targetType ?? null,
          targetId: request.context.targetId ?? null,
        }),
        canRead(role, 'metrics')
          ? retrieveMetrics(client, { to: now })
          : Promise.resolve({ records: [], windows: [] }),
      ]);

      records.push(...audit, ...metrics.records);
      break;
    }

    case 'support': {
      if (!canRead(role, 'support')) {
        throw new CopilotError('FORBIDDEN', 'This role cannot read support tickets.');
      }

      const ticketId = request.context.ticketId;
      if (!ticketId) {
        throw new CopilotError('BAD_REQUEST', 'ticketId is required for a support summary.');
      }

      const support = await retrieveSupport(client, { role, ticketId });
      if (!support.ticket) {
        throw new CopilotError('NOT_FOUND', 'That ticket does not exist.');
      }

      records.push(...support.records);

      // The linked analysis is what makes a ticket answerable; it is part of
      // the ticket snapshot, not a widening of scope.
      if (support.analysisId && canRead(role, 'analysis')) {
        const analysis = await retrieveAnalysis(client, {
          role,
          analysisId: support.analysisId,
        });
        records.push(...analysis.records);
      }

      if (support.userId && canRead(role, 'session')) {
        const sessions = await client.query<{ id: string }>(
          `
          SELECT id FROM portfolio_manager_sessions
          WHERE user_id = $1::uuid
          ORDER BY created_at DESC
          LIMIT 3
          `,
          [support.userId]
        );

        for (const row of sessions.rows) {
          if (records.length >= MAX_RECORDS) break;
          const session = await retrieveSession(client, { role, sessionId: row.id });
          records.push(...session.records);
        }
      }

      break;
    }

    case 'analysis': {
      if (!canRead(role, 'analysis')) {
        throw new CopilotError('FORBIDDEN', 'This role cannot read analyses.');
      }

      const analysisId = request.context.analysisId;
      if (!analysisId) {
        throw new CopilotError('BAD_REQUEST', 'analysisId is required.');
      }

      const analysis = await retrieveAnalysis(client, { role, analysisId });
      if (!analysis.analysis) {
        throw new CopilotError('NOT_FOUND', 'That analysis does not exist.');
      }

      records.push(...analysis.records);
      break;
    }

    case 'session': {
      if (!canRead(role, 'session')) {
        throw new CopilotError('FORBIDDEN', 'This role cannot read portfolio sessions.');
      }

      const sessionId = request.context.sessionId;
      if (!sessionId) {
        throw new CopilotError('BAD_REQUEST', 'sessionId is required.');
      }

      const session = await retrieveSession(client, { role, sessionId });
      if (!session.session) {
        throw new CopilotError('NOT_FOUND', 'That session does not exist.');
      }

      records.push(...session.records);

      // The analysis that drove the session is the "why"; it is already linked
      // from the session's market, not a widening of scope.
      const linkedAnalysis = await client.query<{ id: string }>(
        `
        SELECT d.analysis_result_id AS id
        FROM portfolio_manager_decisions d
        WHERE d.session_id = $1::uuid AND d.analysis_result_id IS NOT NULL
        ORDER BY d.created_at DESC
        LIMIT 1
        `,
        [sessionId]
      );

      const analysisId = linkedAnalysis.rows[0]?.id;
      if (analysisId && canRead(role, 'analysis')) {
        const analysis = await retrieveAnalysis(client, { role, analysisId });
        records.push(...analysis.records);
      }

      break;
    }

    case 'risk_brief': {
      const { action, targetType, targetId } = request.context;
      if (!action) {
        throw new CopilotError('BAD_REQUEST', 'action is required for a risk brief.');
      }

      // Recent rows for this action and this target, over a bounded week.
      const [byAction, byTarget] = await Promise.all([
        retrieveAudit(client, {
          role,
          from: window.from,
          to: window.to,
          action,
          targetType: null,
          targetId: null,
          limit: 20,
        }),
        targetType && targetId
          ? retrieveAudit(client, {
              role,
              from: window.from,
              to: window.to,
              targetType,
              targetId,
              limit: 20,
            })
          : Promise.resolve([]),
      ]);

      records.push(...byAction, ...byTarget);

      if (canRead(role, 'setting')) {
        records.push(...(await retrieveSettings(client, { keys: settingKeysForAction(action) })));
      }

      records.push(
        ...(await retrieveImpact(client, {
          role,
          action,
          targetType,
          targetId,
          sessionId: request.context.sessionId,
          userId: request.context.userId,
        }))
      );

      records.push(...retrieveRunbook(action));

      if (request.context.sessionId && canRead(role, 'session')) {
        const session = await retrieveSession(client, {
          role,
          sessionId: request.context.sessionId,
        });
        records.push(...session.records);
      }

      break;
    }

    default:
      throw new CopilotError('BAD_REQUEST', `Unknown copilot surface: ${String(request.kind)}`);
  }

  // Newest first while trimming (retrieval order), chronological for the prompt.
  const bounded = enforceBudget(dedupe(records)).sort(byTimeAscending);

  return { question, role, window, records: bounded };
}

/** A record can be cited only once, even if two queries returned it. */
function dedupe(records: RetrievedRecord[]): RetrievedRecord[] {
  const seen = new Set<string>();
  const unique: RetrievedRecord[] = [];

  for (const record of records) {
    const key = `${record.type}:${record.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(record);
    if (unique.length >= MAX_RECORDS) break;
  }

  return unique;
}

function enforceBudget(records: RetrievedRecord[]): RetrievedRecord[] {
  const kept: RetrievedRecord[] = [];
  let chars = 0;

  for (const record of records) {
    const size = estimateChars(record);
    // Always keep at least one record: an answer with nothing to cite is not an
    // answer, and the prompt must be able to say "no records found".
    if (kept.length > 0 && chars + size > MAX_CONTEXT_CHARS) break;
    chars += size;
    kept.push(record);
  }

  return kept;
}

export function estimateChars(record: RetrievedRecord): number {
  try {
    return JSON.stringify(record.data).length + record.label.length + 80;
  } catch {
    return 400;
  }
}

function byTimeAscending(a: RetrievedRecord, b: RetrievedRecord): number {
  const at = a.at ? Date.parse(a.at) : 0;
  const bt = b.at ? Date.parse(b.at) : 0;
  if (at === bt) return 0;
  return at - bt;
}

function resolveWindow(
  request: CopilotRequest,
  now: Date
): { from: string; to: string } {
  const defaultSpan =
    request.kind === 'risk_brief' ? MAX_WINDOW_MS : DEFAULT_INCIDENT_WINDOW_MS;

  const to = parseDate(request.context.to) ?? now;
  const from = parseDate(request.context.from) ?? new Date(to.getTime() - defaultSpan);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new CopilotError('BAD_REQUEST', 'Invalid time window.');
  }

  if (from >= to) {
    throw new CopilotError('BAD_REQUEST', '"from" must be before "to".');
  }

  if (to.getTime() - from.getTime() > MAX_WINDOW_MS) {
    throw new CopilotError('BAD_REQUEST', 'Window too large: maximum is 7 days.');
  }

  return { from: from.toISOString(), to: to.toISOString() };
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeQuestion(value: string | undefined): string {
  if (!value) return '';

  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

/**
 * Only an exact-looking identifier (UUID or `action:` prefix) becomes a SQL
 * search term. A conversational question must never be turned into a filter
 * that silently hides the timeline the operator asked for.
 */
export function deriveAuditSearch(question: string): string | null {
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(question);
  if (uuid) return uuid[0];

  const prefixed = /\b(?:action|target)\s*[:=]\s*([a-z0-9_.:-]{3,80})/i.exec(question);
  if (prefixed?.[1]) return prefixed[1];

  return null;
}

/** Which settings a destructive action would touch. */
function settingKeysForAction(action: string): string[] {
  if (/kill|halt|pause/i.test(action)) {
    return ['pm_activations_paused', 'analysis_paused', 'copilot_enabled'];
  }
  if (/analysis|requeue|invalidate/i.test(action)) {
    return ['analysis_paused', 'analysis_pause_message'];
  }
  if (/newsletter/i.test(action)) {
    return ['newsletter_enabled', 'support_enabled'];
  }
  if (/support|ticket|refund|user/i.test(action)) {
    return ['support_enabled', 'support_first_response_target_hours'];
  }

  return ['analysis_paused', 'pm_activations_paused', 'support_enabled', 'newsletter_enabled'];
}
