"use client";

import { useQuery } from "@tanstack/react-query";
import { adminFetch, adminFetchPage } from "@/lib/admin-api";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import type { AnalysisDetail, ExecutionRow, QualityReport } from "@/types/admin";

export interface AnalysisFilters {
  marketId: string;
  recommendation: string;
  outcome: string;
  noTradeReason: string;
  from: string;
  to: string;
}

export function buildAnalysisQuery(filters: AnalysisFilters, cursor: string | null): string {
  const params = new URLSearchParams();
  if (filters.marketId.trim()) params.set("marketId", filters.marketId.trim());
  if (filters.recommendation) params.set("recommendation", filters.recommendation);
  if (filters.outcome) params.set("outcome", filters.outcome);
  if (filters.noTradeReason.trim()) params.set("noTradeReason", filters.noTradeReason.trim());
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (cursor) params.set("cursor", cursor);

  const query = params.toString();
  return query ? `admin/analyses?${query}` : "admin/analyses";
}

export function useAnalyses(filters: AnalysisFilters, cursor: string | null) {
  const { idToken } = useAdminAuth();

  return useQuery({
    queryKey: ["admin", "analyses", filters, cursor],
    queryFn: () => adminFetchPage<ExecutionRow>(buildAnalysisQuery(filters, cursor), { token: idToken }),
    enabled: Boolean(idToken),
    retry: false,
  });
}

export function useAnalysis(analysisId: string) {
  const { idToken } = useAdminAuth();

  return useQuery<AnalysisDetail>({
    queryKey: ["admin", "analysis", analysisId],
    queryFn: () => adminFetch<AnalysisDetail>(`admin/analyses/${analysisId}`, { token: idToken }),
    enabled: Boolean(idToken && analysisId),
    retry: false,
  });
}

/**
 * Quality aggregates for a rolling window.
 *
 * The query key is the window *length*, not the timestamps. Computing `now()`
 * during render would produce a new key on every render, so React Query would
 * start a fresh fetch each time and the panel would never settle — that exact
 * bug shipped once and presented as a permanent loading state.
 *
 * The window is computed inside `queryFn`, so each fetch gets a current range
 * while the cache key stays stable.
 */
export function useQuality(windowDays: number) {
  const { idToken } = useAdminAuth();

  return useQuery<QualityReport>({
    queryKey: ["admin", "quality", windowDays],
    queryFn: () => {
      const to = new Date();
      const from = new Date(to.getTime() - windowDays * 86_400_000);
      const params = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
      });

      return adminFetch<QualityReport>(`admin/analyses/quality?${params.toString()}`, {
        token: idToken,
      });
    },
    enabled: Boolean(idToken),
    retry: false,
    staleTime: 60_000,
  });
}
