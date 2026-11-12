"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { adminFetch, adminFetchPage } from "@/lib/admin-api";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import type { AuditEntry, AuditExport, AuditVerification } from "@/types/admin";

export interface AuditFilters {
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  status: string;
  from: string;
  to: string;
  /** Exact row id, used by copilot citation links. */
  id: string;
}

/** Shared query string so verification and export cover exactly what is on screen. */
export function auditFilterParams(filters: AuditFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.actor.trim()) params.set("actor", filters.actor.trim());
  if (filters.action.trim()) params.set("action", filters.action.trim());
  if (filters.targetType.trim()) params.set("targetType", filters.targetType.trim());
  if (filters.targetId.trim()) params.set("targetId", filters.targetId.trim());
  if (filters.status) params.set("status", filters.status);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.id.trim()) params.set("id", filters.id.trim());
  return params;
}

export function useAudit(filters: AuditFilters, cursor: string | null) {
  const { idToken } = useAdminAuth();

  const params = auditFilterParams(filters);
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

/**
 * Verify the chain over the current filters.
 *
 * Deliberately a mutation, not a query: verification is an explicit act, so the
 * page cannot show "verified" for a chain nobody asked it to check. The server
 * bounds the window (default 1,000 rows, max 5,000) and reports the range it
 * covered.
 */
export function useVerifyAuditChain() {
  const { idToken } = useAdminAuth();

  return useMutation({
    mutationFn: (filters: AuditFilters) => {
      const params = auditFilterParams(filters);
      // `id` narrows the list to one row; a chain check over a single row would
      // be meaningless, so verification covers the rest of the filters.
      params.delete("id");
      const query = params.toString();
      return adminFetch<AuditVerification>(
        query ? `admin/audit/verify?${query}` : "admin/audit/verify",
        { token: idToken }
      );
    },
  });
}

/** Fetch the filtered rows for an export, capped server-side at 5,000. */
export function fetchAuditExport(filters: AuditFilters, token: string | null): Promise<AuditExport> {
  const params = auditFilterParams(filters);
  const query = params.toString();
  return adminFetch<AuditExport>(query ? `admin/audit/export?${query}` : "admin/audit/export", {
    token,
  });
}
