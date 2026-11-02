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
  });
}
