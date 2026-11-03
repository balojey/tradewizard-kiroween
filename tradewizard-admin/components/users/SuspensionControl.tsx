"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { adminFetch } from "@/lib/admin-api";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import { hasRole, type AdminIdentity } from "@/constants/roles";

type AccountStatus = "active" | "suspended" | "banned";

/**
 * Suspend or reinstate an account.
 *
 * Suspension is not cosmetic: the API pauses the user's active portfolio
 * sessions, blocks new activations, and refuses analysis requests. Positions are
 * left untouched — force-exiting someone's money is the kill switch's job, not a
 * status change.
 */
export function SuspensionControl({
  userId,
  identity,
  status,
}: {
  userId: string;
  identity?: AdminIdentity;
  status: string;
}) {
  const { idToken } = useAdminAuth();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canWrite = identity ? hasRole(identity.role, "admin") : false;
  const current = (status as AccountStatus) ?? "active";
  const next: AccountStatus = current === "active" ? "suspended" : "active";
  const suspending = next !== "active";

  const mutation = useMutation({
    mutationFn: () =>
      adminFetch<{ status: string; pausedSessions: number }>(`admin/users/${userId}/status`, {
        token: idToken,
        method: "POST",
        headers: { "Idempotency-Key": globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}` },
        body: { status: next, reason: reason.trim() },
      }),
    onSuccess: () => {
      setOpen(false);
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["admin", "user", userId] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
    onError: (caught: Error) => setError(caught.message),
  });

  // After the hooks, so the rules of hooks hold.
  if (!canWrite || current === "banned") return null;

  return (
    <>
      <Button
        size="sm"
        variant={suspending ? "danger" : "secondary"}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {suspending ? <Ban size={13} aria-hidden /> : <RotateCcw size={13} aria-hidden />}
        {suspending ? "Suspend" : "Reinstate"}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!mutation.isPending}
        title={suspending ? "Suspend this account" : "Reinstate this account"}
        description={
          suspending
            ? "Active portfolio sessions will be paused and new analysis requests will be refused. Open positions are left alone — use the kill switch if you need them exited."
            : "The account returns to active. Portfolio sessions stay paused; resuming them is a separate decision."
        }
        onSubmit={(event) => {
          event.preventDefault();
          if (reason.trim().length < 8) return;
          mutation.mutate();
        }}
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              variant={suspending ? "danger" : "primary"}
              loading={mutation.isPending}
              disabled={reason.trim().length < 8}
            >
              {suspending ? "Suspend account" : "Reinstate account"}
            </Button>
          </>
        }
      >
        <Input
          label="Reason (recorded in the audit log)"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why are you making this change?"
          hint="At least 8 characters. Recorded in the audit log with your name."
          error={error ?? undefined}
          autoFocus
        />
      </Dialog>
    </>
  );
}
