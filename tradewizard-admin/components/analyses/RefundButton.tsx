"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { adminFetch } from "@/lib/admin-api";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import { hasRole, type AdminIdentity } from "@/constants/roles";

/**
 * Refund one credit to everyone who received this result.
 *
 * Safe to retry: a partial unique index means a user is refunded at most once
 * per result, so a repeated confirmation cannot mint credits.
 */
export function RefundButton({
  analysisId,
  identity,
}: {
  analysisId: string;
  identity?: AdminIdentity;
}) {
  const { idToken } = useAdminAuth();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const canWrite = identity ? hasRole(identity.role, "admin") : false;

  const mutation = useMutation({
    mutationFn: () =>
      adminFetch<{ refunded: number; skipped: number; totalRecipients: number }>(
        `admin/analyses/${analysisId}/refund`,
        { token: idToken, method: "POST", body: { reason: reason.trim() } }
      ),
    onSuccess: (data) => {
      setOpen(false);
      setReason("");
      setResult(
        `Refunded ${data.refunded} of ${data.totalRecipients} recipient(s)${data.skipped > 0 ? `, ${data.skipped} already refunded` : ""}.`
      );
    },
    onError: (caught: Error) => setError(caught.message),
  });

  if (!canWrite) return null;

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => { setError(null); setResult(null); setOpen(true); }}>
        <Undo2 size={13} aria-hidden /> Refund credits
      </Button>

      {result && !open && (
        <span role="status" className="text-[11px] text-yes">
          {result}
        </span>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!mutation.isPending}
        title="Refund this analysis"
        description="Adds 1 credit back to every user who received this result. Users already refunded for it are skipped, so this is safe to run more than once."
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
            <Button type="submit" size="sm" loading={mutation.isPending} disabled={reason.trim().length < 8}>
              Refund recipients
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
