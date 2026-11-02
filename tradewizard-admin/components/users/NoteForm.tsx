"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Card";
import { Input, Textarea } from "@/components/ui/Input";
import { adminFetch } from "@/lib/admin-api";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import { hasRole, type AdminIdentity } from "@/constants/roles";

/**
 * Add a support note to a user.
 *
 * The reason field is mandatory because it lands in `admin_audit_log` — a note
 * without a stated reason is useless six months later.
 */
export function NoteForm({ userId, identity }: { userId: string; identity?: AdminIdentity }) {
  const { idToken } = useAdminAuth();
  const queryClient = useQueryClient();

  const [body, setBody] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canWrite = identity ? hasRole(identity.role, "support") : false;

  const mutation = useMutation({
    mutationFn: () =>
      adminFetch(`admin/users/${userId}/notes`, {
        token: idToken,
        method: "POST",
        body: { body: body.trim(), reason: reason.trim() },
      }),
    onSuccess: () => {
      setBody("");
      setReason("");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "user", userId, "notes"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
    onError: (caught: Error) => setError(caught.message),
  });

  if (!canWrite) {
    return (
      <Panel className="mb-4">
        <p className="text-[11.5px] text-muted">
          Notes require the support role. Your role ({identity?.role ?? "unknown"}) is read-only
          here.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Add a note"
      description="Permanent, attributed to you, and visible to everyone who can read this account."
      className="mb-4"
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!body.trim() || reason.trim().length < 8) return;
          mutation.mutate();
        }}
      >
        <Textarea
          label="Note"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="What happened, and what should the next person know?"
        />

        <Input
          label="Reason (recorded in the audit log)"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="At least 8 characters"
          error={error ?? undefined}
        />

        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-faint">
            Written as {identity?.email} and attributed to this user.
          </span>
          <Button
            type="submit"
            size="sm"
            loading={mutation.isPending}
            disabled={!body.trim() || reason.trim().length < 8}
          >
            Add note
          </Button>
        </div>
      </form>
    </Panel>
  );
}
