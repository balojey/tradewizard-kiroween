"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Hand, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { ReauthNotice, errorMessage, isReauthRequired } from "@/components/auth/ReauthNotice";
import { CopilotPanel } from "@/components/copilot/CopilotPanel";
import { adminFetch } from "@/lib/admin-api";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import { hasRole, type AdminIdentity } from "@/constants/roles";

/**
 * Halt all trading for a user.
 *
 * The halt is applied synchronously (new entries stop immediately) and the order
 * cancellation / position exit is dispatched to the risk engine in the
 * background, because it can take a minute per session.
 */
export function KillSwitchControl({
  userId,
  identity,
  halted,
  onLoaded,
}: {
  userId: string;
  identity?: AdminIdentity;
  /** Current state, if the caller already knows it. */
  halted?: boolean;
  onLoaded?: (halted: boolean) => void;
}) {
  const { idToken } = useAdminAuth();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<string | null>(null);

  const canWrite = identity ? hasRole(identity.role, "admin") : false;

  const activate = useMutation({
    mutationFn: () =>
      adminFetch<{ halted: boolean; exitsDispatched: boolean; note: string }>(
        "admin/portfolio/kill-switch",
        { token: idToken, method: "POST", body: { userId, reason: reason.trim() } }
      ),
    onSuccess: (data) => {
      setOpen(false);
      setReason("");
      onLoaded?.(true);
      setResult(data.note);
      void queryClient.invalidateQueries({ queryKey: ["admin", "portfolio"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
    onError: (caught: unknown) => setError(caught),
  });

  const reset = useMutation({
    mutationFn: () =>
      adminFetch("admin/portfolio/kill-switch", {
        token: idToken,
        method: "DELETE",
        body: { userId, reason: "Kill switch cleared by an administrator" },
      }),
    onSuccess: () => {
      onLoaded?.(false);
      setResult("Kill switch cleared. Paused sessions still need to be resumed.");
      void queryClient.invalidateQueries({ queryKey: ["admin", "portfolio"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
    onError: (caught: unknown) => setError(caught),
  });

  if (!canWrite) return null;

  return (
    <>
      {halted ? (
        <Button size="sm" variant="secondary" loading={reset.isPending} onClick={() => reset.mutate()}>
          <ShieldOff size={13} aria-hidden /> Clear kill switch
        </Button>
      ) : (
        <Button size="sm" variant="danger" onClick={() => { setError(null); setResult(null); setOpen(true); }}>
          <Hand size={13} aria-hidden /> Kill switch
        </Button>
      )}

      {result && !open && (
        <span role="status" className="text-[11px] text-muted">
          {result}
        </span>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!activate.isPending}
        title="Halt all trading for this user"
        description="New entries stop immediately. Pending orders are cancelled and open positions are exited in the background — this can take up to a minute per session."
        onSubmit={(event) => {
          event.preventDefault();
          if (reason.trim().length < 8) return;
          activate.mutate();
        }}
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="danger"
              loading={activate.isPending}
              disabled={reason.trim().length < 8}
            >
              Halt trading
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
          error={isReauthRequired(error) ? undefined : errorMessage(error)}
          autoFocus
        />

        <div className="mt-3">
          <CopilotPanel
            compact
            kind="risk_brief"
            title="Review context"
            description="What this halt touches, and what has happened to this account recently. Read-only; it does not block or perform the halt."
            context={{
              action: "portfolio.kill-switch.activate",
              targetType: "user",
              targetId: userId,
            }}
            questionEnabled={false}
            prompts={[{ label: "Review context" }]}
          />
        </div>

        <ReauthNotice error={error} />
      </Dialog>
    </>
  );
}
