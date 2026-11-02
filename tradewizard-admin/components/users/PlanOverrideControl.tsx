"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input, Select } from "@/components/ui/Input";
import { adminFetch } from "@/lib/admin-api";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import { hasRole, type AdminIdentity } from "@/constants/roles";
import { formatDate } from "@/lib/format";

const PLANS = ["free", "starter", "pro", "elite"] as const;

/**
 * Comp a plan (partner, goodwill, incident recovery).
 *
 * The override applies the plan to the subscription so every product path honours
 * it immediately, pauses renewal so the renewal job cannot overwrite it, and
 * expires on its own via the hourly maintenance run.
 */
export function PlanOverrideControl({
  userId,
  identity,
  currentPlan,
  overridePlan,
  overrideExpiresAt,
}: {
  userId: string;
  identity?: AdminIdentity;
  currentPlan: string | null;
  overridePlan: string | null;
  overrideExpiresAt: string | null;
}) {
  const { idToken } = useAdminAuth();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<string>("pro");
  const [expiresAt, setExpiresAt] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canWrite = identity ? hasRole(identity.role, "admin") : false;

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["admin", "user", userId] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
  }

  const grant = useMutation({
    mutationFn: () =>
      adminFetch(`admin/users/${userId}/plan-override`, {
        token: idToken,
        method: "POST",
        body: {
          plan,
          expiresAt: expiresAt ? new Date(`${expiresAt}T00:00:00Z`).toISOString() : null,
          reason: reason.trim(),
        },
      }),
    onSuccess: () => {
      setOpen(false);
      setReason("");
      setExpiresAt("");
      refresh();
    },
    onError: (caught: Error) => setError(caught.message),
  });

  const revoke = useMutation({
    mutationFn: () =>
      adminFetch(`admin/users/${userId}/plan-override`, {
        token: idToken,
        method: "DELETE",
        body: { reason: "Override revoked by an administrator" },
      }),
    onSuccess: refresh,
    onError: (caught: Error) => setError(caught.message),
  });

  if (!canWrite) return null;

  return (
    <>
      {overridePlan ? (
        <span className="flex items-center gap-2">
          <BadgeCheck size={13} aria-hidden className="text-ai" />
          <span className="text-[11px] text-muted">
            comped <span className="text-ai">{overridePlan}</span>
            {overrideExpiresAt ? ` until ${formatDate(overrideExpiresAt)}` : " (no expiry)"}
          </span>
          <Button size="sm" variant="ghost" loading={revoke.isPending} onClick={() => revoke.mutate()}>
            Revoke
          </Button>
        </span>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setPlan(currentPlan === "elite" ? "pro" : "elite");
            setError(null);
            setOpen(true);
          }}
        >
          Comp plan
        </Button>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!grant.isPending}
        title="Comp a plan"
        description={`Current plan ${currentPlan ?? "unknown"}. An override pauses renewal and restores the previous plan when it is revoked or expires.`}
        onSubmit={(event) => {
          event.preventDefault();
          if (reason.trim().length < 8) return;
          grant.mutate();
        }}
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={grant.isPending} disabled={reason.trim().length < 8}>
              Apply override
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Select label="Plan" value={plan} onChange={(event) => setPlan(event.target.value)}>
            {PLANS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>

          <Input
            label="Expires (optional, UTC)"
            type="date"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            hint="Leave empty to comp indefinitely until revoked."
          />

          <Input
            label="Reason (recorded in the audit log)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="At least 8 characters"
            error={error ?? undefined}
          />
        </div>
      </Dialog>
    </>
  );
}
