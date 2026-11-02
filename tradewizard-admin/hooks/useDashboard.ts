"use client";

import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin-api";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import type { DashboardSummary } from "@/types/admin";

export function useDashboard(days: number) {
  const { idToken } = useAdminAuth();

  return useQuery<DashboardSummary>({
    // Keyed on the window length; the API derives the dates (see §9.3).
    queryKey: ["admin", "dashboard", days],
    queryFn: () =>
      adminFetch<DashboardSummary>(`admin/dashboard/summary?days=${days}`, { token: idToken }),
    enabled: Boolean(idToken),
    retry: false,
    staleTime: 60_000,
  });
}
