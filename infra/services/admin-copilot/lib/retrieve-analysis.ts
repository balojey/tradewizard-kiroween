/**
 * Analysis retrieval, including the S3 detail payload.
 *
 * The verdict row is small; the evidence lives in S3 under the `detail/` prefix
 * (14 agent signals, fused consensus, thesis, cross-examination, shadow
 * consensus). We read both, cap the signal list at 14, and emit one citation per
 * agent so an explanation can point at the agent that dissented rather than at
 * the blob as a whole.
 *
 * See docs/plans/warden-ai-copilot.md §5 and §11.
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type { Client } from 'pg';
import type { AdminRole } from '../../shared/admin-auth';
import { sanitizeUntrustedText, truncate } from './redact';
import type { RetrievedRecord } from '../types';

export const SIGNAL_LIMIT = 14;

const s3 = new S3Client({});

export interface AnalysisRow {
  id: string;
  marketId: string;
  marketQuestion: string | null;
  executedAt: Date | string;
  recommendation: string | null;
  consensusProbability: number | null;
  confidence: number | null;
  edge: number | null;
  marketProbability: number | null;
  outcomeStatus: string;
  noTradeReason: string | null;
  shadowAction: string | null;
  shadowProbability: number | null;
  shadowReason: string | null;
  payloadKey: string;
}

export interface AgentSignal {
  agentName?: string;
  direction?: string;
  confidence?: number;
  fairProbability?: number;
  keyDrivers?: unknown;
  riskFactors?: unknown;
}

export interface AnalysisDetailPayload {
  agentSignals?: AgentSignal[];
  fusedSignal?: Record<string, unknown> | null;
  bullThesis?: unknown;
  bearThesis?: unknown;
  crossExamination?: unknown;
  consensus?: unknown;
  consensusMode?: string | null;
  anchoredConsensus?: unknown;
  shadowConsensus?: unknown;
  riskPerspectives?: unknown;
  webResearchSummary?: string;
}

export interface AnalysisRetrieval {
  analysis: AnalysisRow | null;
  detail: AnalysisDetailPayload | null;
  records: RetrievedRecord[];
}

export async function retrieveAnalysis(
  client: Client,
  options: { role: AdminRole; analysisId: string }
): Promise<AnalysisRetrieval> {
  const result = await client.query<AnalysisRow>(
    `
    SELECT
      r.id,
      r.market_id AS "marketId",
      r.executed_at AS "executedAt",
      r.recommendation,
      r.consensus_probability::float8 AS "consensusProbability",
      r.confidence_score::float8 AS "confidence",
      r.edge::float8 AS "edge",
      r.market_probability_at_execution::float8 AS "marketProbability",
      r.outcome_status AS "outcomeStatus",
      r.no_trade_reason AS "noTradeReason",
      r.shadow_action AS "shadowAction",
      r.shadow_probability::float8 AS "shadowProbability",
      r.shadow_reason AS "shadowReason",
      r.result_payload_s3_key AS "payloadKey"
    FROM analysis_results r
    WHERE r.id = $1::uuid
    LIMIT 1
    `,
    [options.analysisId]
  );

  const analysis = result.rows[0];
  if (!analysis) {
    return { analysis: null, detail: null, records: [] };
  }

  const marketResult = await client.query<{ question: string | null }>(
    'SELECT question FROM markets WHERE condition_id = $1 LIMIT 1',
    [analysis.marketId]
  );
  analysis.marketQuestion = marketResult.rows[0]?.question ?? null;

  const detail = await loadDetail(analysis.payloadKey);

  return {
    analysis,
    detail,
    records: buildRecords(analysis, detail, options.role),
  };
}

async function loadDetail(payloadKey: string): Promise<AnalysisDetailPayload | null> {
  const bucket = process.env.ANALYSIS_BUCKET;
  if (!bucket) return null;

  const detailKey = payloadKey.replace(/^results\//, 'detail/');

  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: detailKey }));
    if (!response.Body) return null;

    const text = await response.Body.transformToString('utf-8');
    const parsed = JSON.parse(text) as AnalysisDetailPayload;

    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    // Older results predate the detail file; the verdict row is still usable.
    console.info(
      JSON.stringify({
        metric: 'CopilotDetailMissing',
        key: detailKey,
        error: (error as Error).message,
      })
    );
    return null;
  }
}

function buildRecords(
  analysis: AnalysisRow,
  detail: AnalysisDetailPayload | null,
  role: AdminRole
): RetrievedRecord[] {
  const executedAt = iso(analysis.executedAt);
  const url = `/analyses/${encodeURIComponent(analysis.id)}`;

  const verdict: RetrievedRecord = {
    type: 'analysis',
    id: analysis.id,
    label: `Analysis ${analysis.recommendation ?? 'unknown'} on ${analysis.marketQuestion ?? analysis.marketId}`,
    url,
    at: executedAt,
    data: {
      market: analysis.marketQuestion ?? analysis.marketId,
      executedAt,
      recommendation: analysis.recommendation,
      consensusProbability: analysis.consensusProbability,
      marketProbability: analysis.marketProbability,
      edge: analysis.edge,
      confidence: analysis.confidence,
      outcomeStatus: analysis.outcomeStatus,
      noTradeReason: analysis.noTradeReason,
      shadow: {
        action: analysis.shadowAction,
        probability: analysis.shadowProbability,
        reason: sanitizeUntrustedText(analysis.shadowReason, role, 400),
      },
      consensusMode: detail?.consensusMode ?? null,
      fusedSignal: detail?.fusedSignal ?? null,
      consensus: detail?.consensus ?? null,
      anchoredConsensus: detail?.anchoredConsensus ?? null,
      shadowConsensus: detail?.shadowConsensus ?? null,
      bullThesis: sanitizeUntrustedText(detail?.bullThesis, role, 900),
      bearThesis: sanitizeUntrustedText(detail?.bearThesis, role, 900),
      crossExamination: sanitizeUntrustedText(detail?.crossExamination, role, 1_200),
      riskPerspectives: sanitizeUntrustedText(detail?.riskPerspectives, role, 900),
    },
  };

  const signals = (detail?.agentSignals ?? []).slice(0, SIGNAL_LIMIT);
  const signalRecords = signals.map((signal, index): RetrievedRecord => {
    const agent = sanitizeUntrustedText(signal.agentName, role, 80) || `agent_${index + 1}`;

    return {
      type: 'analysis',
      id: `${analysis.id}#signal:${agent}`,
      label: `Agent signal: ${agent}`,
      url,
      at: executedAt,
      data: {
        agent,
        direction: signal.direction ?? null,
        confidence: numberOrNull(signal.confidence),
        fairProbability: numberOrNull(signal.fairProbability),
        keyDrivers: stringList(signal.keyDrivers, role, 4),
        riskFactors: stringList(signal.riskFactors, role, 4),
      },
    };
  });

  return [verdict, ...signalRecords];
}

function stringList(value: unknown, role: AdminRole, max: number): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .slice(0, max)
    .map((item) => sanitizeUntrustedText(item, role, 240))
    .filter(Boolean);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/** Exported for the prompt-budget test. */
export function detailCharacterCount(detail: AnalysisDetailPayload | null): number {
  if (!detail) return 0;
  try {
    return truncate(JSON.stringify(detail), 100_000).length;
  } catch {
    return 0;
  }
}
