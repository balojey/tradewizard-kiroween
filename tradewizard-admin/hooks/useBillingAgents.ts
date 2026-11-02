"use client";

import { useQuery } from "@tanstack/react-query";
import { adminFetch, adminFetchPage } from "@/lib/admin-api";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import type {
  AgentCostReport,
  AgentPerformanceRow,
  BillingSummary,
  LedgerPayment,
  SubscriptionRow,
} from "@/types/admin";

export function useBillingSummary(windowDays: number) {
  const { idToken } = useAdminAuth();

  return useQuery<BillingSummary>({
    // Keyed on the window length, never on timestamps — see §9.3.
    queryKey: ["admin", "billing", "summary", windowDays],
    queryFn: () => {
      const to = new Date();
      const from = new Date(to.getTime() - windowDays * 86_400_000);
      const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
      return adminFetch<BillingSummary>(`admin/billing/summary?${params}`, { token: idToken });
    },
    enabled: Boolean(idToken),
    retry: false,
    staleTime: 60_000,
  });
}

export function usePayments(cursor: string | null, enabled: boolean) {
  const { idToken } = useAdminAuth();
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";

  return useQuery({
    queryKey: ["admin", "payments", cursor],
    queryFn: () => adminFetchPage<LedgerPayment>(`admin/payments${query}`, { token: idToken }),
    enabled: Boolean(idToken) && enabled,
    retry: false,
  });
}

export function useSubscriptions(
  filters: { plan: string; renewal: string },
  cursor: string | null,
  enabled: boolean
) {
  const { idToken } = useAdminAuth();

  const params = new URLSearchParams();
  if (filters.plan) params.set("plan", filters.plan);
  if (filters.renewal) params.set("renewal", filters.renewal);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();

  return useQuery({
    queryKey: ["admin", "subscriptions", filters, cursor],
    queryFn: () =>
      adminFetchPage<SubscriptionRow>(
        query ? `admin/subscriptions?${query}` : "admin/subscriptions",
        { token: idToken }
      ),
    enabled: Boolean(idToken) && enabled,
    retry: false,
  });
}

export function useAgentPerformance() {
  const { idToken } = useAdminAuth();

  return useQuery<AgentPerformanceRow[]>({
    queryKey: ["admin", "agents", "performance"],
    queryFn: () => adminFetch<AgentPerformanceRow[]>("admin/agents/performance", { token: idToken }),
    enabled: Boolean(idToken),
    retry: false,
    staleTime: 60_000,
  });
}

export function useAgentCost(windowDays: number) {
  const { idToken } = useAdminAuth();

  return useQuery<AgentCostReport>({
    queryKey: ["admin", "agents", "cost", windowDays],
    queryFn: () => {
      const to = new Date();
      const from = new Date(to.getTime() - windowDays * 86_400_000);
      const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
      return adminFetch<AgentCostReport>(`admin/agents/cost?${params}`, { token: idToken });
    },
    enabled: Boolean(idToken),
    retry: false,
    staleTime: 60_000,
  });
}
