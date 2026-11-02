"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Notice } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Card";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { adminFetch } from "@/lib/admin-api";
import { useAdminMe } from "@/hooks/useAdminMe";
import { useAdminAuth } from "@/providers/AdminAuthProvider";
import { hasRole } from "@/constants/roles";
import { formatDateTime } from "@/lib/format";

interface SettingRow {
  key: string;
  type: "boolean" | "string";
  value: boolean | string;
  defaultValue: boolean | string;
  description: string;
  consumer: string;
  allowed?: string[];
  updatedAt: string | null;
  updatedBy: string | null;
}

export default function SettingsPage() {
  const { idToken } = useAdminAuth();
  const { data: identity } = useAdminMe();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: settings, isLoading } = useQuery<SettingRow[]>({
    queryKey: ["admin", "settings"],
    queryFn: () => adminFetch<SettingRow[]>("admin/settings", { token: idToken }),
    enabled: Boolean(idToken),
    retry: false,
  });

  const canWrite = identity ? hasRole(identity.role, "owner") : false;

  const save = useMutation({
    mutationFn: (input: { key: string; value: boolean | string; reason: string }) =>
      adminFetch(`admin/settings/${input.key}`, {
        token: idToken,
        method: "PUT",
        body: { value: input.value, reason: input.reason },
      }),
    onSuccess: () => {
      setEditing(null);
      setReason("");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
    onError: (caught: Error) => setError(caught.message),
  });

  function begin(row: SettingRow) {
    setEditing(row.key);
    setDraft(typeof row.value === "boolean" ? String(row.value) : row.value);
    setReason("");
    setError(null);
  }

  return (
    <Page>
      <PageHeader
        title="Settings"
        description="Runtime configuration. Each switch names the service that reads it, and changes are audited."
      />

      <Notice tone="info" className="mb-4">
        Changes apply within a minute (the product paths cache settings for 60 seconds).
      </Notice>

      {isLoading && <p className="text-xs text-muted">Loading settings…</p>}

      <div className="flex flex-col gap-3">
        {(settings ?? []).map((row) => (
          <Panel key={row.key}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="mono text-xs text-fg">{row.key}</span>
                  <Badge tone="neutral">{row.consumer}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted">{row.description}</p>
                <p className="mt-1 text-[11px] text-muted">
                  {row.updatedAt
                    ? `Last changed ${formatDateTime(row.updatedAt)} by ${row.updatedBy ?? "unknown"}`
                    : `Never changed · default ${String(row.defaultValue)}`}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <span
                  className={`tabular text-sm ${row.value === true ? "text-warning" : "text-fg"}`}
                >
                  {String(row.value)}
                </span>
                <Button size="sm" variant="secondary" disabled={!canWrite} onClick={() => begin(row)}>
                  Change
                </Button>
              </div>
            </div>

            {editing === row.key && (
              <form
                className="mt-4 flex flex-col gap-3 border-t border-border pt-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (reason.trim().length < 8) return;

                  const value =
                    row.type === "boolean" ? draft === "true" : draft.trim();

                  save.mutate({ key: row.key, value, reason: reason.trim() });
                }}
              >
                {row.allowed ? (
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-muted">Value</span>
                    <select
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      className="h-10 rounded-[10px] border border-border bg-surface-2 px-3 text-sm text-fg focus:border-accent focus:outline-none"
                    >
                      {row.allowed.map((option) => (
                        <option key={option} value={option}>
                          {option === "" ? "(follow deployment)" : option}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : row.type === "boolean" ? (
                  <label className="flex items-center gap-2 text-xs text-fg">
                    <input
                      type="checkbox"
                      checked={draft === "true"}
                      onChange={(event) => setDraft(String(event.target.checked))}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    {row.key} enabled
                  </label>
                ) : (
                  <Input
                    label="Value"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                )}

                <Input
                  label="Reason (recorded in the audit log)"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="At least 8 characters"
                  error={error ?? undefined}
                />

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" loading={save.isPending} disabled={reason.trim().length < 8}>
                    Apply
                  </Button>
                </div>
              </form>
            )}
          </Panel>
        ))}
      </div>

      {!canWrite && (
        <p className="mt-4 text-[11px] text-muted">
          Only owners can change settings. You can see the current values.
        </p>
      )}
    </Page>
  );
}
