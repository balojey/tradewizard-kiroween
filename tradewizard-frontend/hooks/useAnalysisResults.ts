'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiClient } from '@/lib/api-client';
import { useMarketTradePerformance } from '@/hooks/useMarketTradePerformance';

// --- Types ---

export type OutcomeStatus =
  | 'pending'
  | 'success'
  | 'failure'
  | 'expired'
  | 'no_trade';

export interface AnalysisResultSummary {
  analysisId: string;
  marketId: string;
  marketQuestion: string;
  recommendation: 'LONG_YES' | 'LONG_NO' | 'NO_TRADE';
  consensusProbability: number;
  confidence: number;
  executedAt: string;
  wasCachedDelivery: boolean;
  /** Whether the recommendation's target/stop has been hit. */
  outcomeStatus?: OutcomeStatus;
  outcomeHitPrice?: number | null;
  entryPrice?: number | null;
  targetPrice?: number | null;
  stopLossPrice?: number | null;
}

export interface AgentSignal {
  agentName: string;
  direction: 'YES' | 'NO' | 'NEUTRAL';
  confidence: number;
  fairProbability: number;
  keyDrivers: string[];
  riskFactors: string[];
  timestamp?: string;
}

export interface FusedSignal {
  weightedFairProbability: number;
  fusionConfidence: number;
  signalAlignment: number;
  conflictMap: Array<Record<string, string | number>>;
}

export interface Thesis {
  direction: string;
  fairProbability: number;
  keyArguments: string[];
  confidence: number;
}

export interface CrossExaminationResult {
  bullScore: number;
  bearScore: number;
}

export interface ConsensusResult {
  probability: number;
  confidence: number;
  failed: boolean;
  disagreementIndex: number;
}

export interface AnalysisResultDetail {
  // ─── Core trade recommendation ───────────────────────────────────────────
  marketId: string;
  action: 'LONG_YES' | 'LONG_NO' | 'NO_TRADE';
  entryZone: [number, number];
  targetZone: [number, number];
  stopLoss: number;
  expectedValue: number;
  winProbability: number;
  liquidityRisk: 'low' | 'medium' | 'high';
  /** Whether the recommendation's target/stop has been hit. */
  outcomeStatus?: OutcomeStatus;
  outcomeHitPrice?: number | null;
  entryPrice?: number | null;
  targetPrice?: number | null;
  stopLossPrice?: number | null;
  explanation: {
    summary: string;
    coreThesis: string;
    keyCatalysts: string[];
    failureScenarios: string[];
    uncertaintyNote: string;
    riskPerspectives: string;
  };
  metadata: {
    consensusProbability: number;
    marketProbability: number;
    edge: number;
    confidenceBand: [number, number];
    totalLlmCalls: number;
    executionDurationMs: number;
    agentsUsed: string[];
    marketQuestion: string;
    disagreementIndex?: number;
    /** Ensemble confidence in the call (0–1), distinct from winProbability. */
    consensusConfidence?: number;
    /** Fused-signal alignment (0–1). */
    signalAlignment?: number;
    riskRewardRatio?: number;
    volatility?: number;
    marketEndDate?: string;
    divergenceGuardTriggered?: boolean;
    thesisVetoTriggered?: boolean;
    noTradeReason?: string;
  };
  // ─── Full analysis detail (present for results after agent memory launch) ─
  agentSignals?: AgentSignal[];
  fusedSignal?: FusedSignal;
  bullThesis?: Thesis;
  bearThesis?: Thesis;
  crossExamination?: CrossExaminationResult;
  consensus?: ConsensusResult;
  riskPerspectives?: string;
  /** Raw labelled risk output from the three philosophy agents. */
  riskPerspectivesRaw?: string;
  webResearchSummary?: string;
  /** Which consensus configuration produced the live call. */
  consensusMode?: 'agent' | 'anchored';
  /** Non-live consensus output kept for comparison. */
  anchoredConsensus?: unknown;
}

interface AnalysisHistoryPage {
  items: AnalysisResultSummary[];
  nextCursor: string | null;
  totalCount: number;
}

// --- Hooks ---

export function useAnalysisHistoryPaginated() {
  return useInfiniteQuery<AnalysisHistoryPage>({
    queryKey: ['analysis-history-paginated'],
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string> = { limit: '10' };
      if (pageParam) {
        params.cursor = pageParam as string;
      }
      return apiClient.get<AnalysisHistoryPage>('/analysis/history', params);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
    retry: 2,
  });
}

export function useAnalysisDetail(analysisId: string | null) {
  const detailQuery = useQuery<AnalysisResultDetail>({
    queryKey: ['analysis-detail', analysisId],
    queryFn: () => apiClient.get<AnalysisResultDetail>(`/analysis/${analysisId}`),
    enabled: !!analysisId,
    staleTime: 5 * 60_000, // 5 minutes - results don't change
    retry: 2,
  });

  // Use the same authoritative outcome ledger as the market details page.
  const performanceQuery = useMarketTradePerformance(
    detailQuery.data?.marketId ?? null,
  );

  const data = useMemo(() => {
    const base = detailQuery.data;
    if (!base) return base;

    const match = performanceQuery.data?.recommendations.find(
      (rec) => rec.analysisId === analysisId,
    );
    if (!match) return base;

    return {
      ...base,
      outcomeStatus: match.outcomeStatus,
      outcomeHitPrice: match.outcomeHitPrice ?? base.outcomeHitPrice,
      entryPrice: match.entryPrice ?? base.entryPrice,
      targetPrice: match.targetPrice ?? base.targetPrice,
      stopLossPrice: match.stopLossPrice ?? base.stopLossPrice,
    };
  }, [detailQuery.data, performanceQuery.data, analysisId]);

  return { ...detailQuery, data };
}
