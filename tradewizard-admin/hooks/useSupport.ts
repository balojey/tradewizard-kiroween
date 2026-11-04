"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminFetch, adminFetchPage } from "@/lib/admin-api";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import type {
  SupportMessage,
  SupportSummary,
  SupportTicketDetailPayload,
  SupportTicketRow,
} from "@/types/admin";

export type SupportAssigneeFilter = "all" | "me" | "unassigned";

export interface SupportFilters {
  status: string;
  assignee: SupportAssigneeFilter;
  topic: string;
  q: string;
}

export function buildSupportListQuery(
  filters: SupportFilters,
  cursor: string | null
): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.assignee !== "all") params.set("assignee", filters.assignee);
  if (filters.topic) params.set("topic", filters.topic);
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (cursor) params.set("cursor", cursor);

  const query = params.toString();
  return query ? `admin/support/tickets?${query}` : "admin/support/tickets";
}

export function useSupportTickets(filters: SupportFilters, cursor: string | null) {
  const { idToken } = useAdminAuth();

  return useQuery({
    queryKey: ["admin", "support", "tickets", filters, cursor],
    queryFn: () =>
      adminFetchPage<SupportTicketRow>(buildSupportListQuery(filters, cursor), {
        token: idToken,
      }),
    enabled: Boolean(idToken),
    retry: false,
  });
}

export function useSupportSummary() {
  const { idToken } = useAdminAuth();

  return useQuery({
    queryKey: ["admin", "support", "summary"],
    queryFn: () => adminFetch<SupportSummary>("admin/support/summary", { token: idToken }),
    enabled: Boolean(idToken),
    retry: false,
  });
}

export function useSupportTicket(id: string) {
  const { idToken } = useAdminAuth();

  return useQuery({
    queryKey: ["admin", "support", "ticket", id],
    queryFn: () =>
      adminFetch<SupportTicketDetailPayload>(`admin/support/tickets/${id}`, {
        token: idToken,
      }),
    enabled: Boolean(idToken && id),
    retry: false,
  });
}

function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useSupportMutations(ticketId: string) {
  const { idToken } = useAdminAuth();
  const queryClient = useQueryClient();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "support"] });
  };

  const claim = useMutation({
    mutationFn: () =>
      adminFetch<{ assignedAdminSub: string }>(
        `admin/support/tickets/${ticketId}/claim`,
        { token: idToken, method: "POST" }
      ),
    onSuccess: invalidate,
  });

  const release = useMutation({
    mutationFn: () =>
      adminFetch<{ assignedAdminSub: null }>(
        `admin/support/tickets/${ticketId}/release`,
        { token: idToken, method: "POST" }
      ),
    onSuccess: invalidate,
  });

  const reply = useMutation({
    mutationFn: (input: { body: string; internal: boolean }) =>
      adminFetch<{
        message: SupportMessage;
        emailSent: boolean;
        suppressed: boolean;
        internal: boolean;
      }>(`admin/support/tickets/${ticketId}/messages`, {
        token: idToken,
        method: "POST",
        body: { ...input, requestId: newRequestId() },
      }),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: (input: {
      status?: string;
      priority?: string;
      assignedAdminSub?: string | null;
      reason: string;
    }) =>
      adminFetch<{ resolvedEmailSent: boolean }>(`admin/support/tickets/${ticketId}`, {
        token: idToken,
        method: "PUT",
        body: input,
      }),
    onSuccess: invalidate,
  });

  return { claim, release, reply, update };
}
