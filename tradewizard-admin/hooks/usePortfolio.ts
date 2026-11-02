"use client";

import { useQuery } from "@tanstack/react-query";
import { adminFetch, adminFetchPage } from "@/lib/admin-api";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import type {
  PortfolioDecisionRow,
  PortfolioExposure,
  PortfolioSessionDetail,
  PortfolioSessionRow,
  PortfolioTradeRow,
} from "@/types/admin";

export interface SessionFilters {
  status: string;
  userId: string;
  marketId: string;
}

export function useExposure() {
  const { idToken } = useAdminAuth();

  return useQuery<PortfolioExposure>({
    queryKey: ["admin", "portfolio", "exposure"],
    queryFn: () => adminFetch<PortfolioExposure>("admin/portfolio/exposure", { token: idToken }),
    enabled: Boolean(idToken),
    retry: false,
    staleTime: 30_000,
  });
}

export function useSessions(filters: SessionFilters, cursor: string | null) {
  const { idToken } = useAdminAuth();

  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.marketId.trim()) params.set("marketId", filters.marketId.trim());
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();

  return useQuery({
    queryKey: ["admin", "portfolio", "sessions", filters, cursor],
    queryFn: () =>
      adminFetchPage<PortfolioSessionRow>(
        query ? `admin/portfolio/sessions?${query}` : "admin/portfolio/sessions",
        { token: idToken }
      ),
    enabled: Boolean(idToken),
    retry: false,
  });
}

export function useSession(sessionId: string) {
  const { idToken } = useAdminAuth();

  return useQuery<PortfolioSessionDetail>({
    queryKey: ["admin", "portfolio", "session", sessionId],
    queryFn: () =>
      adminFetch<PortfolioSessionDetail>(`admin/portfolio/sessions/${sessionId}`, { token: idToken }),
    enabled: Boolean(idToken && sessionId),
    retry: false,
  });
}

export function useSessionTrades(sessionId: string, cursor: string | null, enabled: boolean) {
  const { idToken } = useAdminAuth();
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";

  return useQuery({
    queryKey: ["admin", "portfolio", "session", sessionId, "trades", cursor],
    queryFn: () =>
      adminFetchPage<PortfolioTradeRow>(
        `admin/portfolio/sessions/${sessionId}/trades${query}`,
        { token: idToken }
      ),
    enabled: Boolean(idToken && sessionId) && enabled,
    retry: false,
  });
}

export function useSessionDecisions(sessionId: string, cursor: string | null, enabled: boolean) {
  const { idToken } = useAdminAuth();
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";

  return useQuery({
    queryKey: ["admin", "portfolio", "session", sessionId, "decisions", cursor],
    queryFn: () =>
      adminFetchPage<PortfolioDecisionRow>(
        `admin/portfolio/sessions/${sessionId}/decisions${query}`,
        { token: idToken }
      ),
    enabled: Boolean(idToken && sessionId) && enabled,
    retry: false,
  });
}
