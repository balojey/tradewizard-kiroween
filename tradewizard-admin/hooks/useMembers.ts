"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin-api";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import type { AdminMember } from "@/types/admin";

export function useMembers() {
  const { idToken } = useAdminAuth();

  return useQuery<AdminMember[]>({
    queryKey: ["admin", "members"],
    queryFn: () => adminFetch<AdminMember[]>("admin/admins", { token: idToken }),
    enabled: Boolean(idToken),
    retry: false,
  });
}

export function useMemberMutations() {
  const { idToken } = useAdminAuth();
  const queryClient = useQueryClient();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "members"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
  };

  return {
    add: useMutation({
      mutationFn: (input: { email: string; role: string; reason: string }) =>
        adminFetch("admin/admins", { token: idToken, method: "POST", body: input }),
      onSuccess: refresh,
    }),
    changeRole: useMutation({
      mutationFn: (input: { sub: string; role: string; reason: string }) =>
        adminFetch(`admin/admins/${input.sub}`, {
          token: idToken,
          method: "PUT",
          body: { role: input.role, reason: input.reason },
        }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (input: { sub: string; reason: string }) =>
        adminFetch(`admin/admins/${input.sub}`, {
          token: idToken,
          method: "DELETE",
          body: { reason: input.reason },
        }),
      onSuccess: refresh,
    }),
  };
}
