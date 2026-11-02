"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { adminFetch, adminFetchPage } from "@/lib/admin-api";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import type {
  AnalysisRow,
  CreditRow,
  NoteRow,
  PaymentRow,
  SessionRow,
  UserDetail,
  UserSummary,
} from "@/types/admin";

export interface UserFilters {
  q: string;
  plan: string;
  status: string;
  hasPm: boolean;
}

export function buildUserListQuery(filters: UserFilters, cursor: string | null): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.plan) params.set("plan", filters.plan);
  if (filters.status) params.set("status", filters.status);
  if (filters.hasPm) params.set("hasPm", "true");
  if (cursor) params.set("cursor", cursor);

  const query = params.toString();
  return query ? `admin/users?${query}` : "admin/users";
}

function usePage<T>(
  key: unknown[],
  path: string,
  enabled = true
): UseQueryResult<{ items: T[]; nextCursor: string | null }> {
  const { idToken } = useAdminAuth();

  return useQuery({
    queryKey: key,
    queryFn: () => adminFetchPage<T>(path, { token: idToken }),
    enabled: enabled && Boolean(idToken),
    retry: false,
  });
}

export function useUsers(filters: UserFilters, cursor: string | null) {
  return usePage<UserSummary>(
    ["admin", "users", filters, cursor],
    buildUserListQuery(filters, cursor)
  );
}

export function useUser(userId: string) {
  const { idToken } = useAdminAuth();

  return useQuery<UserDetail>({
    queryKey: ["admin", "user", userId],
    queryFn: () => adminFetch<UserDetail>(`admin/users/${userId}`, { token: idToken }),
    enabled: Boolean(idToken && userId),
    retry: false,
  });
}

function subResource(userId: string, resource: string, cursor: string | null) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return `admin/users/${userId}/${resource}${query}`;
}

export function useUserCredits(userId: string, cursor: string | null, enabled: boolean) {
  return usePage<CreditRow>(
    ["admin", "user", userId, "credits", cursor],
    subResource(userId, "credits", cursor),
    enabled
  );
}

export function useUserAnalyses(userId: string, cursor: string | null, enabled: boolean) {
  return usePage<AnalysisRow>(
    ["admin", "user", userId, "analyses", cursor],
    subResource(userId, "analyses", cursor),
    enabled
  );
}

export function useUserSessions(userId: string, cursor: string | null, enabled: boolean) {
  return usePage<SessionRow>(
    ["admin", "user", userId, "sessions", cursor],
    subResource(userId, "sessions", cursor),
    enabled
  );
}

export function useUserPayments(userId: string, cursor: string | null, enabled: boolean) {
  return usePage<PaymentRow>(
    ["admin", "user", userId, "payments", cursor],
    subResource(userId, "payments", cursor),
    enabled
  );
}

export function useUserNotes(userId: string, cursor: string | null, enabled: boolean) {
  return usePage<NoteRow>(
    ["admin", "user", userId, "notes", cursor],
    subResource(userId, "notes", cursor),
    enabled
  );
}
