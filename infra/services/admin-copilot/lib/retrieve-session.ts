/**
 * Portfolio session retrieval.
 *
 * The session is the customer's money; only roles that can already open the
 * session page may retrieve it. Trades and decisions are capped at ten each and
 * ordered newest-first so "what happened before the exit?" has an answer
 * without reading a whole ledger.
 *
 * See docs/plans/warden-ai-copilot.md §5.
 */

import type { Client } from 'pg';
import type { AdminRole } from '../../shared/admin-auth';
import { sanitizeUntrustedText } from './redact';
import type { RetrievedRecord } from '../types';

export const TRADE_LIMIT = 10;
export const DECISION_LIMIT = 10;

export interface SessionRow {
  id: string;
  userId: string;
  userEmail: string | null;
  marketId: string;
  personaId: string;
  status: string;
  investmentAmount: number | null;
  realizedPnl: number | null;
  unrealizedPnl: number | null;
  totalTrades: number | null;
  winningTrades: number | null;
  positionDirection: string | null;
  positionSize: number | null;
  positionEntryPrice: number | null;
  terminationReason: string | null;
  createdAt: Date | string;
  terminatedAt: Date | string | null;
  updatedAt: Date | string;
}

export interface TradeRow {
  id: string;
  direction: string;
  side: string;
  tradePurpose: string;
  status: string;
  sizeUsdc: number | null;
  price: number | null;
  fillPrice: number | null;
  realizedPnl: number | null;
  exitReason: string | null;
  reasoning: string | null;
  createdAt: Date | string;
}

export interface DecisionRow {
  id: string;
  action: string;
  reasoning: string | null;
  skipReason: string | null;
  convictionScore: number | null;
  createdAt: Date | string;
}

export interface SessionRetrieval {
  session: SessionRow | null;
  records: RetrievedRecord[];
}

export async function retrieveSession(
  client: Client,
  options: { role: AdminRole; sessionId: string }
): Promise<SessionRetrieval> {
  const sessionResult = await client.query<SessionRow>(
    `
    SELECT
      s.id, s.user_id AS "userId", u.email AS "userEmail",
      s.market_id AS "marketId", s.persona_id AS "personaId", s.status,
      s.investment_amount::float8 AS "investmentAmount",
      s.realized_pnl::float8 AS "realizedPnl",
      s.unrealized_pnl::float8 AS "unrealizedPnl",
      s.total_trades AS "totalTrades", s.winning_trades AS "winningTrades",
      s.position_direction AS "positionDirection",
      s.position_size::float8 AS "positionSize",
      s.position_entry_price::float8 AS "positionEntryPrice",
      s.termination_reason AS "terminationReason",
      s.created_at AS "createdAt", s.terminated_at AS "terminatedAt",
      s.updated_at AS "updatedAt"
    FROM portfolio_manager_sessions s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.id = $1::uuid
    LIMIT 1
    `,
    [options.sessionId]
  );

  const session = sessionResult.rows[0];
  if (!session) return { session: null, records: [] };

  const [trades, decisions] = await Promise.all([
    client.query<TradeRow>(
      `
      SELECT id, direction, side, trade_purpose AS "tradePurpose", status,
             size_usdc::float8 AS "sizeUsdc", price::float8 AS price,
             fill_price::float8 AS "fillPrice", realized_pnl::float8 AS "realizedPnl",
             exit_reason AS "exitReason", reasoning, created_at AS "createdAt"
      FROM portfolio_manager_trades
      WHERE session_id = $1::uuid
      ORDER BY created_at DESC
      LIMIT $2
      `,
      [session.id, TRADE_LIMIT]
    ),
    client.query<DecisionRow>(
      `
      SELECT id, action, reasoning, skip_reason AS "skipReason",
             conviction_score::float8 AS "convictionScore", created_at AS "createdAt"
      FROM portfolio_manager_decisions
      WHERE session_id = $1::uuid
      ORDER BY created_at DESC
      LIMIT $2
      `,
      [session.id, DECISION_LIMIT]
    ),
  ]);

  return {
    session,
    records: [
      {
        type: 'session',
        id: session.id,
        label: `Session ${session.personaId} · ${session.status}`,
        url: `/portfolio/${encodeURIComponent(session.id)}`,
        at: iso(session.createdAt),
        data: {
          status: session.status,
          persona: session.personaId,
          marketId: session.marketId,
          createdAt: iso(session.createdAt),
          terminatedAt: iso(session.terminatedAt),
          terminationReason: sanitizeUntrustedText(session.terminationReason, options.role, 400),
          investmentAmount: session.investmentAmount,
          realizedPnl: session.realizedPnl,
          unrealizedPnl: session.unrealizedPnl,
          totalTrades: session.totalTrades,
          winningTrades: session.winningTrades,
          position: session.positionDirection
            ? {
                direction: session.positionDirection,
                size: session.positionSize,
                entryPrice: session.positionEntryPrice,
              }
            : null,
          recentTrades: trades.rows.map((trade) => ({
            at: iso(trade.createdAt),
            purpose: trade.tradePurpose,
            side: trade.side,
            direction: trade.direction,
            status: trade.status,
            sizeUsdc: trade.sizeUsdc,
            price: trade.price,
            fillPrice: trade.fillPrice,
            realizedPnl: trade.realizedPnl,
            exitReason: sanitizeUntrustedText(trade.exitReason, options.role, 200),
            reasoning: sanitizeUntrustedText(trade.reasoning, options.role, 400),
          })),
          recentDecisions: decisions.rows.map((decision) => ({
            at: iso(decision.createdAt),
            action: decision.action,
            conviction: decision.convictionScore,
            reasoning: sanitizeUntrustedText(decision.reasoning, options.role, 400),
            skipReason: sanitizeUntrustedText(decision.skipReason, options.role, 200),
          })),
        },
      },
    ],
  };
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}
