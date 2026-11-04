"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminFetch, adminFetchPage } from "@/lib/admin-api";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import type {
  NewsletterCampaign,
  NewsletterContent,
  NewsletterSubscriber,
  NewsletterSummary,
} from "@/types/admin";

export interface CampaignFilters {
  status: string;
}

export function useCampaigns(filters: CampaignFilters, cursor: string | null) {
  const { idToken } = useAdminAuth();
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();

  return useQuery({
    queryKey: ["admin", "newsletter", "campaigns", filters, cursor],
    queryFn: () =>
      adminFetchPage<NewsletterCampaign>(
        query ? `admin/newsletter/campaigns?${query}` : "admin/newsletter/campaigns",
        { token: idToken }
      ),
    enabled: Boolean(idToken),
    retry: false,
  });
}

export function useCampaign(id: string) {
  const { idToken } = useAdminAuth();

  return useQuery({
    queryKey: ["admin", "newsletter", "campaign", id],
    queryFn: () =>
      adminFetch<{ campaign: NewsletterCampaign; deliveries: Record<string, number> }>(
        `admin/newsletter/campaigns/${id}`,
        { token: idToken }
      ),
    enabled: Boolean(idToken && id),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.campaign.status === "sending" ? 5_000 : false,
  });
}

export function useNewsletterSummary() {
  const { idToken } = useAdminAuth();

  return useQuery({
    queryKey: ["admin", "newsletter", "summary"],
    queryFn: () => adminFetch<NewsletterSummary>("admin/newsletter/summary", { token: idToken }),
    enabled: Boolean(idToken),
    retry: false,
  });
}

export interface CampaignDraft {
  subject: string;
  preheader?: string;
  template: "market_brief" | "product_update";
  content: NewsletterContent;
}

export function useNewsletterMutations(id: string) {
  const { idToken } = useAdminAuth();
  const queryClient = useQueryClient();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "newsletter"] });
  };

  const create = useMutation({
    mutationFn: (input: CampaignDraft & { reason: string }) =>
      adminFetch<NewsletterCampaign>("admin/newsletter/campaigns", {
        token: idToken,
        method: "POST",
        body: input,
      }),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: (input: CampaignDraft & { reason: string }) =>
      adminFetch<NewsletterCampaign>(`admin/newsletter/campaigns/${id}`, {
        token: idToken,
        method: "PUT",
        body: input,
      }),
    onSuccess: invalidate,
  });

  const preview = useMutation({
    mutationFn: (input: CampaignDraft) =>
      adminFetch<{ html: string }>(`admin/newsletter/campaigns/${id}/preview`, {
        token: idToken,
        method: "POST",
        body: input,
      }),
  });

  const test = useMutation({
    mutationFn: () =>
      adminFetch<{ sentTo: string }>(`admin/newsletter/campaigns/${id}/test`, {
        token: idToken,
        method: "POST",
      }),
    onSuccess: invalidate,
  });

  const send = useMutation({
    mutationFn: (reason: string) =>
      adminFetch<{ recipients: number }>(`admin/newsletter/campaigns/${id}/send`, {
        token: idToken,
        method: "POST",
        body: { reason },
      }),
    onSuccess: invalidate,
  });

  const cancel = useMutation({
    mutationFn: (reason: string) =>
      adminFetch(`admin/newsletter/campaigns/${id}/cancel`, {
        token: idToken,
        method: "POST",
        body: { reason },
      }),
    onSuccess: invalidate,
  });

  return { create, update, preview, test, send, cancel };
}


export function useSubscribers(
  filters: { status: string; q: string },
  cursor: string | null
) {
  const { idToken } = useAdminAuth();
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();

  return useQuery({
    queryKey: ["admin", "newsletter", "subscribers", filters, cursor],
    queryFn: () =>
      adminFetchPage<NewsletterSubscriber>(
        query ? `admin/newsletter/subscribers?${query}` : "admin/newsletter/subscribers",
        { token: idToken }
      ),
    enabled: Boolean(idToken),
    retry: false,
  });
}
