/**
 * Blast-radius facts for the risk brief.
 *
 * Counts only, always scoped to the supplied target. This is what turns "reset
 * the kill switch" into "this user has 3 active sessions and 2 failed orders in
 * the last hour" without reading anyone else's data.
 *
 * See docs/plans/warden-ai-copilot.md §3 (Phase 3) and §5.
 */

import type { Client } from 'pg';
import type { AdminRole } from '../../shared/admin-auth';
import type { RetrievedRecord } from '../types';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ImpactInput {
  role: AdminRole;
  action?: string;
  targetType?: string;
  targetId?: string;
  sessionId?: string;
  userId?: string;
}

export async function retrieveImpact(
  client: Client,
  input: ImpactInput
): Promise<RetrievedRecord[]> {
  const records: RetrievedRecord[] = [];

  // How often this action has run is useful even when the target is a setting
  // key rather than an id, so it is computed before any UUID gate.
  if (input.action) {
    const sameAction = await client.query<{ total: string; failed: string }>(
      `
      SELECT count(*)::text AS total,
             count(*) FILTER (WHERE status = 'failed')::text AS failed
      FROM admin_audit_log
      WHERE action = $1 AND created_at >= now() - interval '7 days'
      `,
      [input.action]
    );

    records.push({
      type: 'metric',
      id: `impact:action:${input.action}`,
      label: `Times "${input.action}" ran in the last 7 days`,
      url: `/audit?action=${encodeURIComponent(input.action)}`,
      data: {
        action: input.action,
        executions7d: Number(sameAction.rows[0]?.total ?? 0),
        failed7d: Number(sameAction.rows[0]?.failed ?? 0),
      },
    });
  }

  const targetId = input.targetId ?? input.userId ?? input.sessionId ?? null;

  if (!targetId || !UUID_PATTERN.test(targetId)) {
    return records;
  }

  const isUserTarget =
    input.targetType === 'user' ||
    input.userId !== undefined ||
    Boolean(input.action && /user|kill|halt|suspend|ban/i.test(input.action));

  if (!isUserTarget) return records;

  const sessions = await client.query<{
    total: string;
    active: string;
    capital: string | null;
  }>(
    `
    SELECT count(*)::text AS total,
           count(*) FILTER (WHERE status IN ('active', 'paused'))::text AS active,
           coalesce(sum(amount_in_positions + amount_in_pending_orders), 0)::text AS capital
    FROM portfolio_manager_sessions
    WHERE user_id = $1::uuid
    `,
    [targetId]
  );

  const row = sessions.rows[0];

  records.push({
    type: 'metric',
    id: `impact:user:${targetId}`,
    label: 'Blast radius: portfolio sessions',
    url: `/users/${encodeURIComponent(targetId)}`,
    data: {
      target: 'user',
      totalSessions: Number(row?.total ?? 0),
      liveSessions: Number(row?.active ?? 0),
      capitalInFlightUsd: Number(row?.capital ?? 0),
    },
  });

  const audit = await client.query<{ total: string; failed: string }>(
    `
    SELECT count(*)::text AS total,
           count(*) FILTER (WHERE status = 'failed')::text AS failed
    FROM admin_audit_log
    WHERE target_type = 'user' AND target_id = $1
      AND created_at >= now() - interval '24 hours'
    `,
    [targetId]
  );

  records.push({
    type: 'metric',
    id: `impact:audit:${targetId}`,
    label: 'Recent admin actions on this user (24h)',
    url: `/audit?targetType=user&targetId=${encodeURIComponent(targetId)}`,
    data: {
      adminActions24h: Number(audit.rows[0]?.total ?? 0),
      failedActions24h: Number(audit.rows[0]?.failed ?? 0),
    },
  });

  return records;
}
