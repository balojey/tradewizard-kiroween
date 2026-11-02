"use client";

import { useState } from "react";
import { DataTable, type Column } from "@/components/data/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Input, Select } from "@/components/ui/Input";
import { Notice } from "@/components/ui/Notice";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { useAdminMe } from "@/hooks/useAdminMe";
import { useMemberMutations, useMembers } from "@/hooks/useMembers";
import { ROLE_DESCRIPTION, ROLE_LABEL, ROLE_RANK, hasRole } from "@/constants/roles";
import type { AdminMember } from "@/types/admin";

const ROLES = ["analyst", "support", "admin", "owner"] as const;

type DialogState =
  | { kind: "add" }
  | { kind: "role"; member: AdminMember }
  | { kind: "remove"; member: AdminMember };

/**
 * Team access. Membership is Cognito group state, so changes take effect at the
 * next token refresh (≤1 hour) — the authorizer reads groups from the token.
 */
export function MembersView() {
  const { data: identity } = useAdminMe();
  const { data: members, isLoading, error } = useMembers();
  const mutations = useMemberMutations();

  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("support");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const isOwner = identity ? hasRole(identity.role, "owner") : false;
  const pending = mutations.add.isPending || mutations.changeRole.isPending || mutations.remove.isPending;

  function open(next: DialogState) {
    setDialog(next);
    setFormError(null);
    setReason("");
    setEmail("");
    setRole(next.kind === "role" ? next.member.role : "support");
  }

  function submit() {
    if (!dialog || reason.trim().length < 8) return;

    const onError = (caught: Error) => setFormError(caught.message);

    if (dialog.kind === "add") {
      mutations.add.mutate(
        { email: email.trim(), role, reason: reason.trim() },
        { onSuccess: () => setDialog(null), onError }
      );
      return;
    }
    if (dialog.kind === "role") {
      mutations.changeRole.mutate(
        { sub: dialog.member.sub, role, reason: reason.trim() },
        { onSuccess: () => setDialog(null), onError }
      );
      return;
    }
    mutations.remove.mutate(
      { sub: dialog.member.sub, reason: reason.trim() },
      { onSuccess: () => setDialog(null), onError }
    );
  }

  const columns: Column<AdminMember>[] = [
    {
      key: "email",
      header: "Member",
      render: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[12px] text-fg">{row.email}</span>
          <span className="mono truncate text-[10.5px] text-faint">{row.sub.slice(0, 12)}…</span>
        </span>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (row) => (
        <Badge tone={row.role === "owner" ? "ai" : row.role === "admin" ? "accent" : "neutral"}>
          {ROLE_LABEL[row.role]}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Cognito",
      render: (row) => <span className="text-[11.5px] text-muted">{row.cognitoStatus}</span>,
    },
    ...(isOwner
      ? [
          {
            key: "actions",
            header: "",
            align: "right" as const,
            render: (row: AdminMember) => (
              <span className="flex justify-end gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    open({ kind: "role", member: row });
                  }}
                >
                  Change role
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    open({ kind: "remove", member: row });
                  }}
                >
                  Remove
                </Button>
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <Page>
      <PageHeader
        title="Members"
        description="Who can use this portal, and at what level. Changes apply at the member's next sign-in — tokens carry group membership for up to an hour."
        actions={
          isOwner && (
            <Button size="sm" onClick={() => open({ kind: "add" })}>
              Add member
            </Button>
          )
        }
        meta={
          <>
            <span>{members ? `${members.length} members` : "—"}</span>
            <span aria-hidden className="text-border-strong">·</span>
            <span>group membership is authoritative in Cognito</span>
          </>
        }
      />

      {!isOwner && (
        <Notice tone="warning" title="Read-only for your role" className="mb-4">
          Only owners can add, re-role or remove members. You can see the list, but the actions are
          not available to you.
        </Notice>
      )}

      {error && (
        <Notice tone="error" title="Could not load members" className="mb-3">
          {(error as Error).message}
        </Notice>
      )}

      <DataTable
        columns={columns}
        rows={members ?? []}
        getRowId={(row) => row.sub}
        loading={isLoading}
        emptyMessage="No members yet."
        emptyHint="That should be impossible — check the Cognito group and the API's IAM permissions."
      />

      <Panel title="Roles" description="Ordered by rank. A role grants everything below it." className="mt-4">
        <ul className="flex flex-col">
          {ROLES.map((option) => (
            <li
              key={option}
              className="flex items-start justify-between gap-4 border-b border-border-soft py-2 last:border-0"
            >
              <span className="flex shrink-0 items-center gap-2">
                <Badge tone={option === "owner" ? "ai" : "neutral"}>{ROLE_LABEL[option]}</Badge>
                <span className="num text-[10.5px] text-faint">rank {ROLE_RANK[option]}</span>
              </span>
              <span className="max-w-[460px] text-right text-[11.5px] text-muted">
                {ROLE_DESCRIPTION[option]}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      <Dialog
        open={Boolean(dialog)}
        onClose={() => setDialog(null)}
        dismissible={!pending}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        title={
          !dialog
            ? ""
            : dialog.kind === "add"
              ? "Add a member"
              : dialog.kind === "role"
                ? `Change role for ${dialog.member.email}`
                : `Remove ${dialog.member.email}`
        }
        description={
          dialog?.kind === "remove"
            ? "They lose portal access on their next request. Their TradeWizard account is untouched."
            : "Membership is a Cognito group. The change is audited and applies at their next sign-in."
        }
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              variant={dialog?.kind === "remove" ? "danger" : "primary"}
              loading={pending}
              disabled={reason.trim().length < 8 || (dialog?.kind === "add" && !email.includes("@"))}
            >
              {dialog?.kind === "add"
                ? "Add member"
                : dialog?.kind === "role"
                  ? "Change role"
                  : "Remove member"}
            </Button>
          </>
        }
      >
        {dialog && (
          <div className="flex flex-col gap-3">
            {dialog.kind === "add" && (
              <Input
                label="Email of an existing TradeWizard account"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="person@example.com"
                autoFocus
              />
            )}

            {dialog.kind !== "remove" && (
              <Select label="Role" value={role} onChange={(event) => setRole(event.target.value)}>
                {ROLES.map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABEL[option]} — {ROLE_DESCRIPTION[option]}
                  </option>
                ))}
              </Select>
            )}

            <Input
              label="Reason (recorded in the audit log)"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="At least 8 characters"
              error={formError ?? undefined}
            />
          </div>
        )}
      </Dialog>
    </Page>
  );
}
