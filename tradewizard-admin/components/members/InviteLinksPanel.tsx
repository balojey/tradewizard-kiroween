"use client";

import { useState } from "react";
import { ReauthNotice, errorMessage, isReauthRequired } from "@/components/auth/ReauthNotice";
import { DataTable, type Column } from "@/components/data/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Input, Select } from "@/components/ui/Input";
import { Notice } from "@/components/ui/Notice";
import { formatDateTime, formatRelative } from "@/lib/format";
import {
  useInviteLinkMutations,
  useInviteLinkRedemptions,
  useInviteLinks,
} from "@/hooks/useInviteLinks";
import { ROLE_DESCRIPTION, ROLE_LABEL } from "@/constants/roles";
import type { AdminInviteLink, AdminMember, CreatedInviteLink } from "@/types/admin";

const ROLES: AdminMember["role"][] = ["analyst", "support", "admin", "owner"];

const LIFETIMES = [
  { hours: 24, label: "24 hours" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days" },
  { hours: 8760, label: "365 days" },
] as const;

const STATUS_TONE: Record<AdminInviteLink["status"], "yes" | "warning" | "no" | "neutral"> = {
  active: "yes",
  exhausted: "neutral",
  expired: "warning",
  revoked: "no",
};

function StatusBadge({ status }: { status: AdminInviteLink["status"] }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot>
      {status}
    </Badge>
  );
}

/**
 * Owner-only invite links.
 *
 * A link is a bearer credential that grants one role, so the panel is written to
 * make the two irreversible things obvious: the URL is shown once, and revoking
 * cannot be undone. Everything else (lifetime, uses, redemptions) is arithmetic.
 */
export function InviteLinksPanel({ isOwner }: { isOwner: boolean }) {
  const { data: links, isLoading, error } = useInviteLinks();
  const mutations = useInviteLinkMutations();

  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<AdminInviteLink | null>(null);
  const [redemptionsFor, setRedemptionsFor] = useState<AdminInviteLink | null>(null);
  const [created, setCreated] = useState<CreatedInviteLink | null>(null);

  const [role, setRole] = useState<AdminMember["role"]>("analyst");
  const [lifetime, setLifetime] = useState<number>(168);
  const [maxUses, setMaxUses] = useState("5");
  const [reason, setReason] = useState("");
  const [disableUnclaimed, setDisableUnclaimed] = useState(true);
  const [formError, setFormError] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);

  const pending = mutations.create.isPending || mutations.revoke.isPending;
  const usesValid = Number.isInteger(Number(maxUses)) && Number(maxUses) >= 1 && Number(maxUses) <= 50;

  function openCreate() {
    setCreating(true);
    setRole("analyst");
    setLifetime(168);
    setMaxUses("5");
    setReason("");
    setFormError(null);
  }

  function openRevoke(link: AdminInviteLink) {
    setRevoking(link);
    setReason("");
    setDisableUnclaimed(true);
    setFormError(null);
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the field is selectable as a fallback.
    }
  }

  const columns: Column<AdminInviteLink>[] = [
    {
      key: "role",
      header: "Role",
      render: (row) => (
        <Badge tone={row.role === "owner" ? "ai" : "neutral"}>{ROLE_LABEL[row.role]}</Badge>
      ),
    },
    {
      key: "created",
      header: "Created",
      render: (row) => (
        <span className="flex flex-col">
          <span className="text-[11.5px] text-fg">{formatDateTime(row.createdAt)}</span>
          <span className="text-[10.5px] text-faint">{row.createdByEmail}</span>
        </span>
      ),
    },
    {
      key: "expires",
      header: "Expires",
      render: (row) => (
        <span className="flex flex-col">
          <span className="text-[11.5px] text-fg">{formatDateTime(row.expiresAt)}</span>
          <span className="text-[10.5px] text-faint">{formatRelative(row.expiresAt)}</span>
        </span>
      ),
    },
    {
      key: "uses",
      header: "Uses",
      render: (row) => (
        <span className="num text-[11.5px] text-fg">
          {row.useCount}
          <span className="text-faint">/{row.maxUses}</span>
        </span>
      ),
    },
    {
      key: "joined",
      header: "Joined",
      render: (row) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={(event) => {
            event.stopPropagation();
            setRedemptionsFor(row);
          }}
        >
          {row.redemptionCount}
        </Button>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    ...(isOwner
      ? [
          {
            key: "actions",
            header: "",
            align: "right" as const,
            render: (row: AdminInviteLink) =>
              row.status === "active" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    openRevoke(row);
                  }}
                >
                  Revoke
                </Button>
              ) : (
                <span className="text-[10.5px] text-faint">—</span>
              ),
          },
        ]
      : []),
  ];

  return (
    <Panel
      title="Invite links"
      description="A link lets someone create their own Warden account at one role. Share it only with the people you mean to add."
      className="mt-4"
      actions={
        isOwner && (
          <Button size="sm" onClick={openCreate}>
            Create link
          </Button>
        )
      }
      bodyClassName="p-0"
    >
      {error && (
        <Notice tone="error" title="Could not load invite links" className="m-3 mb-0">
          {(error as Error).message}
        </Notice>
      )}

      <DataTable
        columns={columns}
        rows={links ?? []}
        getRowId={(row) => row.id}
        loading={isLoading}
        emptyMessage="No invite links yet."
        emptyHint={
          isOwner
            ? "Create one when you want to add someone without knowing their email."
            : "Only owners can create links."
        }
      />

      <p className="border-t border-border-soft px-4 py-2.5 text-[10.5px] leading-relaxed text-faint">
        Accounts created through a link get a dedicated <span className="mono">+warden</span>{" "}
        address — their TradeWizard product login is never touched. Revoking a link stops new
        registrations; people who already joined stay members until you remove them.
      </p>

      {/* Create */}
      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        dismissible={!pending}
        title="Create an invite link"
        description="The URL is shown once. Anyone who opens it can create an account at this role until it expires, runs out of uses, or is revoked."
        onSubmit={(event) => {
          event.preventDefault();
          if (reason.trim().length < 8 || !usesValid) return;
          mutations.create.mutate(
            { role, expiresInHours: lifetime, maxUses: Number(maxUses), reason: reason.trim() },
            {
              onSuccess: (link) => {
                setCreating(false);
                setCreated(link);
              },
              onError: (caught) => setFormError(caught),
            }
          );
        }}
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              loading={mutations.create.isPending}
              disabled={reason.trim().length < 8 || !usesValid}
            >
              Create link
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Select
            label="Role"
            value={role}
            onChange={(event) => setRole(event.target.value as AdminMember["role"])}
          >
            {ROLES.map((option) => (
              <option key={option} value={option}>
                {ROLE_LABEL[option]} — {ROLE_DESCRIPTION[option]}
              </option>
            ))}
          </Select>

          {role === "owner" && (
            <Notice tone="warning" title="An owner link is the keys to the portal">
              Anyone who opens it becomes an owner: settings, role changes, and every mutation.
              Share it privately, and prefer a short lifetime.
            </Notice>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Lifetime"
              value={String(lifetime)}
              onChange={(event) => setLifetime(Number(event.target.value))}
            >
              {LIFETIMES.map((option) => (
                <option key={option.hours} value={option.hours}>
                  {option.label}
                </option>
              ))}
            </Select>

            <Input
              label="Maximum uses"
              type="number"
              min={1}
              max={50}
              value={maxUses}
              onChange={(event) => setMaxUses(event.target.value)}
              hint="1–50 accounts"
              error={maxUses && !usesValid ? "Enter a whole number between 1 and 50" : undefined}
            />
          </div>

          <Input
            label="Reason (recorded in the audit log)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why are you making this change?"
            hint="At least 8 characters. Recorded in the audit log with your name."
            error={isReauthRequired(formError) ? undefined : errorMessage(formError)}
          />

          <ReauthNotice error={formError} />
        </div>
      </Dialog>

      {/* Created — the only time the URL exists in the UI */}
      <Dialog
        open={Boolean(created)}
        onClose={() => setCreated(null)}
        dismissible={false}
        title="Link created — copy it now"
        description="For safety only a hash is stored, so this URL cannot be shown again. If you lose it, create another link and revoke this one."
        footer={
          <Button type="button" size="sm" onClick={() => setCreated(null)}>
            I have copied it
          </Button>
        }
      >
        {created && (
          <div className="flex flex-col gap-3">
            <div className="rounded-[8px] border border-border-strong/60 bg-surface-2 p-3">
              <p className="mono break-all text-[11.5px] leading-relaxed text-fg">{created.url}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => copyUrl(created.url)}>
                {copied ? "Copied" : "Copy link"}
              </Button>
              <span className="text-[11px] text-muted">
                {ROLE_LABEL[created.role]} · {created.maxUses}{" "}
                {created.maxUses === 1 ? "use" : "uses"} · expires{" "}
                {formatDateTime(created.expiresAt)}
              </span>
            </div>
            <p className="text-[10.5px] leading-relaxed text-faint">
              Whoever opens it will be asked for their email and will sign in with that address{" "}
              <span className="mono">+warden</span>. Send it through a channel you trust; anyone
              holding it can join.
            </p>
          </div>
        )}
      </Dialog>

      {/* Revoke */}
      <Dialog
        open={Boolean(revoking)}
        onClose={() => setRevoking(null)}
        dismissible={!pending}
        title={revoking ? `Revoke the ${ROLE_LABEL[revoking.role]} link?` : ""}
        description="New registrations stop immediately. This cannot be undone."
        onSubmit={(event) => {
          event.preventDefault();
          if (!revoking || reason.trim().length < 8) return;
          mutations.revoke.mutate(
            { id: revoking.id, reason: reason.trim(), disableUnclaimed },
            {
              onSuccess: () => setRevoking(null),
              onError: (caught) => setFormError(caught),
            }
          );
        }}
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setRevoking(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="danger"
              loading={mutations.revoke.isPending}
              disabled={reason.trim().length < 8}
            >
              Revoke link
            </Button>
          </>
        }
      >
        {revoking && (
          <div className="flex flex-col gap-3">
            <p className="text-[11.5px] leading-relaxed text-muted">
              {revoking.redemptionCount > 0
                ? `${revoking.redemptionCount} ${
                    revoking.redemptionCount === 1 ? "person has" : "people have"
                  } joined through this link. They keep their accounts.`
                : "Nobody has joined through this link yet."}
            </p>

            <label className="flex items-start gap-2 rounded-[8px] border border-border-strong/50 bg-surface-2 p-3">
              <input
                type="checkbox"
                checked={disableUnclaimed}
                onChange={(event) => setDisableUnclaimed(event.target.checked)}
                className="mt-0.5"
              />
              <span className="text-[11.5px] leading-relaxed text-fg">
                Also disable accounts created by this link that never signed in
                <span className="mt-0.5 block text-[10.5px] text-faint">
                  Those accounts still hold an unused temporary password. People who have already
                  signed in are never touched.
                </span>
              </span>
            </label>

            <Input
              label="Reason (recorded in the audit log)"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why are you making this change?"
              hint="At least 8 characters. Recorded in the audit log with your name."
              error={isReauthRequired(formError) ? undefined : errorMessage(formError)}
            />

            <ReauthNotice error={formError} />
          </div>
        )}
      </Dialog>

      {/* Redemptions */}
      <RedemptionsDialog link={redemptionsFor} onClose={() => setRedemptionsFor(null)} />
    </Panel>
  );
}

function RedemptionsDialog({
  link,
  onClose,
}: {
  link: AdminInviteLink | null;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useInviteLinkRedemptions(link?.id ?? null);

  return (
    <Dialog
      open={Boolean(link)}
      onClose={onClose}
      size="md"
      title={link ? `Joined through the ${ROLE_LABEL[link.role]} link` : ""}
      description="Accounts created by this link. Pending means the invitation was sent but the temporary password has not been replaced yet."
      footer={
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {error && (
        <Notice tone="error" title="Could not load redemptions" className="mb-3">
          {(error as Error).message}
        </Notice>
      )}

      {isLoading && <p className="text-[11.5px] text-muted">Loading…</p>}

      {!isLoading && (data ?? []).length === 0 && (
        <p className="text-[11.5px] text-muted">Nobody has joined through this link yet.</p>
      )}

      <ul className="flex flex-col">
        {(data ?? []).map((redemption) => (
          <li
            key={redemption.id}
            className="flex items-start justify-between gap-3 border-b border-border-soft py-2 last:border-0"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[11.5px] text-fg">{redemption.email}</span>
              <span className="text-[10.5px] text-faint">
                {formatDateTime(redemption.createdAt)}
              </span>
            </span>
            <span className="shrink-0 text-right">
              {redemption.claimed === null ? (
                <span className="text-[10.5px] text-faint">unknown</span>
              ) : redemption.claimed ? (
                <Badge tone="yes" dot>
                  active
                </Badge>
              ) : (
                <Badge tone="warning" dot>
                  pending
                </Badge>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
