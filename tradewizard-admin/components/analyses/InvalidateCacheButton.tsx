"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { adminFetch } from "@/lib/admin-api";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import { hasRole, type AdminIdentity } from "@/constants/roles";

/**
 * Drop the cached result for this market so the next request re-runs it.
 *
 * The in-flight marker is preserved by the API, so an invalidation cannot cause
 * two executions to run concurrently.
 */
export function InvalidateCacheButton({
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
      adminFetch<{ marketId: string; deletedEntries: number }>(
        `admin/analyses/${analysisId}/invalidate-cache`,
        { token: idToken, method: "POST", body: { reason: reason.trim() } }
      ),
    onSuccess: (data) => {
      setOpen(false);
      setReason("");
      setResult(
        data.deletedEntries === 0
          ? "No cached entry remained; the next request will run fresh."
          : `Removed ${data.deletedEntries} cached entr${data.deletedEntries === 1 ? "y" : "ies"}.`
      );
    },
    onError: (caught: Error) => setError(caught.message),
  });

  if (!canWrite) return null;

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => { setError(null); setResult(null); setOpen(true); }}>
        <Eraser size={13} aria-hidden /> Invalidate cache
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
        title="Invalidate cached analysis"
        description="Removes this market's cached result so the next request re-runs the pipeline. A run already in flight is left alone."
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
              Invalidate
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
