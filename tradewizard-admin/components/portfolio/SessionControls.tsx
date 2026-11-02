"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { adminFetch } from "@/lib/admin-api";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import { hasRole, type AdminIdentity } from "@/constants/roles";

/**
 * Pause or resume a portfolio session.
 *
 * Pausing cancels pending orders and returns their capital, because a paused
 * session would not manage fills from working orders. Resuming is refused while
 * the account is suspended or a kill switch is active.
 */
export function SessionControls({
  sessionId,
  identity,
  status,
}: {
  sessionId: string;
  identity?: AdminIdentity;
  status: string;
}) {
  const { idToken } = useAdminAuth();
  const queryClient = useQueryClient();

  const [action, setAction] = useState<"pause" | "resume" | "terminate" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canWrite = identity ? hasRole(identity.role, "support") : false;
  const canTerminate = identity ? hasRole(identity.role, "admin") : false;

  const mutation = useMutation({
    mutationFn: () =>
      adminFetch(`admin/portfolio/sessions/${sessionId}/${action}`, {
        token: idToken,
        method: "POST",
        body: { reason: reason.trim() },
      }),
    onSuccess: () => {
      setAction(null);
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["admin", "portfolio"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
    onError: (caught: Error) => setError(caught.message),
  });

  if (!canWrite) return null;
  if (status !== "active" && status !== "paused") return null;

  const canPause = status === "active";
  const canResume = status === "paused";

  return (
    <>
      {canPause && (
        <Button size="sm" variant="secondary" onClick={() => { setError(null); setAction("pause"); }}>
          <Pause size={13} aria-hidden /> Pause
        </Button>
      )}
      {canResume && (
        <Button size="sm" variant="secondary" onClick={() => { setError(null); setAction("resume"); }}>
          <Play size={13} aria-hidden /> Resume
        </Button>
      )}
      {canTerminate && (
        <Button size="sm" variant="danger" onClick={() => { setError(null); setAction("terminate"); }}>
          <Square size={13} aria-hidden /> Terminate
        </Button>
      )}

      <Dialog
        open={Boolean(action)}
        onClose={() => setAction(null)}
        dismissible={!mutation.isPending}
        title={
          action === "terminate"
            ? "Terminate session"
            : action === "pause"
              ? "Pause session"
              : "Resume session"
        }
        description={
          action === "pause"
            ? "Pending orders are cancelled and their capital returned to available. Open positions are left in place."
            : action === "resume"
              ? "The session resumes evaluating new analyses. Refused while the account is suspended or a kill switch is active."
              : "This ends the session permanently: working orders are cancelled, the open position is exited at market, and the guard schedule is removed. It cannot be undone — the user would have to open a new session."
        }
        onSubmit={(event) => {
          event.preventDefault();
          if (reason.trim().length < 8) return;
          mutation.mutate();
        }}
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              variant={action === "terminate" ? "danger" : "primary"}
              loading={mutation.isPending}
              disabled={reason.trim().length < 8}
            >
              {action === "pause"
                ? "Pause session"
                : action === "resume"
                  ? "Resume session"
                  : "Terminate and exit"}
            </Button>
          </>
        }
      >
        <Input
          label="Reason (recorded in the audit log)"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="At least 8 characters"
          error={error ?? undefined}
          autoFocus
        />
      </Dialog>
    </>
  );
}
