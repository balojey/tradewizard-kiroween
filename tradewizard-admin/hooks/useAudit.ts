"use client";

import { useQuery } from "@tanstack/react-query";
import { adminFetchPage } from "@/lib/admin-api";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import type { AuditEntry } from "@/types/admin";

export interface AuditFilters {
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  status: string;
}

export function useAudit(filters: AuditFilters, cursor: string | null) {
  const { idToken } = useAdminAuth();

  const params = new URLSearchParams();
  if (filters.actor.trim()) params.set("actor", filters.actor.trim());
  if (filters.action.trim()) params.set("action", filters.action.trim());
  if (filters.targetType.trim()) params.set("targetType", filters.targetType.trim());
  if (filters.targetId.trim()) params.set("targetId", filters.targetId.trim());
  if (filters.status) params.set("status", filters.status);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();

  return useQuery({
    queryKey: ["admin", "audit", filters, cursor],
    queryFn: () =>
      adminFetchPage<AuditEntry>(query ? `admin/audit?${query}` : "admin/audit", { token: idToken }),
    enabled: Boolean(idToken),
    retry: false,
  });
}
