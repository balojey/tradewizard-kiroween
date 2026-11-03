"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { adminFetch } from "@/lib/admin-api";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import { hasRole, type AdminIdentity } from "@/constants/roles";

/**
 * Grant credits to a user.
 *
 * The client generates an Idempotency-Key per confirmation, so a double click or
 * a retried request cannot credit the account twice — the API replays the first
 * result instead.
 */
export function GrantCreditsDialog({
  userId,
  identity,
  currentBalance,
}: {
  userId: string;
  identity?: AdminIdentity;
  currentBalance: number | null;
}) {
  const { idToken } = useAdminAuth();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("10");
  const [reason, setReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const canWrite = identity ? hasRole(identity.role, "support") : false;

  const parsedAmount = Number(amount);
  const validAmount = Number.isInteger(parsedAmount) && parsedAmount > 0 && parsedAmount <= 100_000;

  const mutation = useMutation({
    mutationFn: () =>
      adminFetch<{ credited: number; creditsRemaining: number }>(`admin/users/${userId}/credits`, {
        token: idToken,
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: { amount: parsedAmount, reason: reason.trim() },
      }),
    onSuccess: (data) => {
      setResult(`Credited ${data.credited} — new balance ${data.creditsRemaining}.`);
      setReason("");
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["admin", "user", userId] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "user", userId, "credits"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
    onError: (caught: Error) => setError(caught.message),
  });

  // Checked after all hooks: an early return above them would violate the rules
  // of hooks (the lint rule is right about this).
  if (!canWrite) return null;

  function start() {
    setError(null);
    setResult(null);
    // One key per confirmation attempt. A retry of the same confirmation reuses
    // it, which is exactly what makes the operation safe.
    setIdempotencyKey(globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}`);
    setOpen(true);
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={start}>
        <Plus size={13} aria-hidden /> Grant credits
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
        title="Grant credits"
        description={`Current balance ${currentBalance ?? "—"}. The change is recorded in the ledger as an operator adjustment and written to the audit log.`}
        onSubmit={(event) => {
          event.preventDefault();
          if (!validAmount || reason.trim().length < 8) return;
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
              loading={mutation.isPending}
              disabled={!validAmount || reason.trim().length < 8}
            >
              Grant {validAmount ? parsedAmount : 0}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input
            label="Amount"
            type="number"
            min={1}
            max={100000}
            step={1}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            error={!validAmount ? "Enter a whole number between 1 and 100,000" : undefined}
          />

          <Input
            label="Reason (recorded in the audit log)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why are you making this change?"
            hint="At least 8 characters. Recorded in the audit log with your name."
            error={error ?? undefined}
          />
        </div>
      </Dialog>
    </>
  );
}
