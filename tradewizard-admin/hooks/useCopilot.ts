"use client";

/**
 * Copilot transport.
 *
 * One mutation per question, deliberately: an answer is never optimistic and is
 * never cached across questions. Reads the capability probe first so the UI can
 * hide the panels when `copilot_enabled` is off.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin-api";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import type { CopilotAnswer, CopilotKind, CopilotStatus } from "@/types/admin";

const PATHS: Record<CopilotKind, string> = {
  incident: "admin/copilot/incident",
  support: "admin/copilot/support",
  analysis: "admin/copilot/analysis",
  session: "admin/copilot/session",
  risk_brief: "admin/copilot/risk-brief",
};

export interface CopilotQuery {
  kind: CopilotKind;
  body: Record<string, unknown>;
}

/** Capability probe. Fails closed in the UI: no status, no panel. */
export function useCopilotStatus() {
  const { idToken } = useAdminAuth();

  return useQuery({
    queryKey: ["admin", "copilot", "status"],
    queryFn: () =>
      adminFetch<CopilotStatus>("admin/copilot/status", { token: idToken }),
    enabled: Boolean(idToken),
    retry: false,
    staleTime: 60_000,
  });
}

export function useCopilot() {
  const { idToken } = useAdminAuth();

  return useMutation({
    mutationFn: ({ kind, body }: CopilotQuery) =>
      adminFetch<CopilotAnswer>(PATHS[kind], {
        token: idToken,
        method: "POST",
        body,
      }),
    retry: false,
  });
}
