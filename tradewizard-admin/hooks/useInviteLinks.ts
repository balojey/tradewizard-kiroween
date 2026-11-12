"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin-api";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import type {
  AdminInviteLink,
  AdminInviteRedemption,
  AdminMember,
  CreatedInviteLink,
} from "@/types/admin";

export function useInviteLinks() {
  const { idToken } = useAdminAuth();

  return useQuery<AdminInviteLink[]>({
    queryKey: ["admin", "invite-links"],
    queryFn: () => adminFetch<AdminInviteLink[]>("admin/invite-links", { token: idToken }),
    enabled: Boolean(idToken),
    retry: false,
  });
}

export function useInviteLinkRedemptions(linkId: string | null) {
  const { idToken } = useAdminAuth();

  return useQuery<AdminInviteRedemption[]>({
    queryKey: ["admin", "invite-links", linkId, "redemptions"],
    queryFn: () =>
      adminFetch<AdminInviteRedemption[]>(
        `admin/invite-links/${linkId}/redemptions`,
        { token: idToken }
      ),
    enabled: Boolean(idToken && linkId),
    retry: false,
  });
}

export function useInviteLinkMutations() {
  const { idToken } = useAdminAuth();
  const queryClient = useQueryClient();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "invite-links"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
  };

  return {
    create: useMutation({
      mutationFn: (input: {
        role: AdminMember["role"];
        expiresInHours: number;
        maxUses: number;
        reason: string;
      }) =>
        adminFetch<CreatedInviteLink>("admin/invite-links", {
          token: idToken,
          method: "POST",
          body: input,
        }),
      onSuccess: refresh,
    }),
    revoke: useMutation({
      mutationFn: (input: { id: string; reason: string; disableUnclaimed: boolean }) =>
        adminFetch<{ id: string; revoked: boolean; disabled: number }>(
          `admin/invite-links/${input.id}`,
          {
            token: idToken,
            method: "DELETE",
            body: { reason: input.reason, disableUnclaimed: input.disableUnclaimed },
          }
        ),
      onSuccess: refresh,
    }),
  };
}
