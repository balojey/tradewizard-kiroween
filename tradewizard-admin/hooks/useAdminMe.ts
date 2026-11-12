"use client";

import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin-api";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import type { AdminIdentity } from "@/constants/roles";

/**
 * The portal's identity probe. Everything else in the UI hangs off this: it
 * proves the token works, the role is real, and the Cognito identity maps to a
 * product account (`linked`).
 */
export function useAdminMe() {
  const { idToken } = useAdminAuth();

  return useQuery<AdminIdentity>({
    queryKey: ["admin", "me"],
    queryFn: () => adminFetch<AdminIdentity>("admin/me", { token: idToken }),
    enabled: Boolean(idToken),
    retry: false,
    staleTime: 60_000,
    // Identity is a security check, not a data fetch: re-check once a minute so
    // a member removed mid-session is ejected without waiting for a navigation.
    // The authorizer is authoritative; this only makes the UI notice sooner.
    refetchInterval: 60_000,
  });
}
