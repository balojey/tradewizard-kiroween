"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Bot, Lock, Send, User } from "lucide-react";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input, Textarea } from "@/components/ui/Input";
import { Notice } from "@/components/ui/Notice";
import { useAdminMe } from "@/hooks/useAdminMe";
import { useSupportMutations, useSupportTicket } from "@/hooks/useSupport";
import { SupportAnalysisDialog } from "@/components/support/SupportAnalysisDialog";
import { marketSlugFromContext, marketUrlFromContext, productUrl } from "@/lib/product-url";
import { hasRole } from "@/constants/roles";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { SupportMessage } from "@/types/admin";

const STATUS_TONE = {
  open: "accent",
  pending: "warning",
  resolved: "yes",
  closed: "neutral",
} as const;

const STATUSES = ["open", "pending", "resolved", "closed"] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

type Notice_ = { tone: "info" | "success" | "warning" | "error"; title: string; body?: string };

export function SupportTicketView() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data, isLoading, isError, error } = useSupportTicket(id);
  const { data: identity } = useAdminMe();
  const mutations = useSupportMutations(id);

  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [notice, setNotice] = useState<Notice_ | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [updateOpen, setUpdateOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [nextStatus, setNextStatus] = useState<string>("");
  const [nextPriority, setNextPriority] = useState<string>("");
  const [nextAssignee, setNextAssignee] = useState<string>("");
  const [reason, setReason] = useState("");

  if (isLoading) {
    return (
      <Page>
        <div className="h-6 w-40 animate-pulse rounded bg-surface-2" />
        <div className="mt-4 h-40 animate-pulse rounded bg-surface-2" />
      </Page>
    );
  }

  if (isError || !data) {
    return (
      <Page>
        <Notice tone="error" title="Could not load this ticket">
          {error instanceof Error ? error.message : "Please try again."}
        </Notice>
      </Page>
    );
  }

  const { ticket, messages, requester, canReply } = data;
  const isAdmin = identity ? hasRole(identity.role, "admin") : false;
  const isMine = ticket.assignedAdminSub === identity?.sub;
  const heldByOther = Boolean(ticket.assignedAdminSub) && !isMine;
  const blockedByOwnership = heldByOther && !isAdmin;

  const context = ticket.context ?? {};
  const marketSlug = marketSlugFromContext(context);
  const marketHref = marketUrlFromContext(context);

  function openUpdate() {
    setNextStatus(ticket.status);
    setNextPriority(ticket.priority);
    setNextAssignee(ticket.assignedAdminSub ?? "");
    setReason("");
    setActionError(null);
    setUpdateOpen(true);
  }

  function submitReply() {
    if (!reply.trim()) return;

    mutations.reply.mutate(
      { body: reply.trim(), internal },
      {
        onSuccess: (result) => {
          setReply("");
          setNotice(
            result.internal
              ? {
                  tone: "info",
                  title: "Internal note added",
                  body: "The customer cannot see this and was not emailed.",
                }
              : result.emailSent
                ? {
                    tone: "success",
                    title: "Reply sent",
                    body: "The customer was emailed a fresh thread link.",
                  }
                : result.suppressed
                  ? {
                      tone: "warning",
                      title: "Reply stored, email suppressed",
                      body: "Another reply went out less than a minute ago, so no second email was sent. Their existing link still works.",
                    }
                  : {
                      tone: "warning",
                      title: "Reply stored, email failed",
                      body: "The customer will see it when they open their link. Send another message to retry the email.",
                    }
          );
        },
        onError: (caught) => setActionError(caught.message),
      }
    );
  }

  function submitUpdate() {
    mutations.update.mutate(
      {
        status: nextStatus !== ticket.status ? nextStatus : undefined,
        priority: nextPriority !== ticket.priority ? nextPriority : undefined,
        assignedAdminSub:
          nextAssignee !== (ticket.assignedAdminSub ?? "")
            ? nextAssignee || null
            : undefined,
        reason,
      },
      {
        onSuccess: (result) => {
          setUpdateOpen(false);
          setNotice({
            tone: "success",
            title: "Ticket updated",
            body:
              nextStatus === "resolved"
                ? result.resolvedEmailSent
                  ? "The customer was told it is resolved."
                  : "Resolved, but the notification email failed."
                : undefined,
          });
        },
        onError: (caught) => setActionError(caught.message),
      }
    );
  }

  return (
    <Page>
      <PageHeader
        crumbs={[{ label: "Support", href: "/support" }, { label: ticket.ref }]}
        title={ticket.subject}
        description={
          <>
            <span className="mono">{ticket.ref}</span> · opened{" "}
            {formatDateTime(ticket.createdAt)} · updated {formatRelative(ticket.lastMessageAt)}
          </>
        }
        actions={
          <>
            {!ticket.assignedAdminSub && (
              <Button
                size="sm"
                loading={mutations.claim.isPending}
                onClick={() =>
                  mutations.claim.mutate(undefined, {
                    onError: (caught) => setActionError(caught.message),
                  })
                }
              >
                Claim
              </Button>
            )}

            {isMine && (
              <Button
                size="sm"
                variant="secondary"
                loading={mutations.release.isPending}
                onClick={() =>
                  mutations.release.mutate(undefined, {
                    onError: (caught) => setActionError(caught.message),
                  })
                }
              >
                Release
              </Button>
            )}

            <Button size="sm" variant="secondary" onClick={openUpdate}>
              Update
            </Button>
          </>
        }
        meta={
          <>
            <Badge tone={STATUS_TONE[ticket.status]}>{ticket.status}</Badge>
            <Badge tone={ticket.priority === "normal" ? "neutral" : "warning"}>
              {ticket.priority}
            </Badge>
            {ticket.overdue && <Badge tone="no">overdue</Badge>}
            <span>
              {ticket.assignedAdminSub
                ? isMine
                  ? "Held by you"
                  : `Held by ${ticket.assignedAdminSub.slice(0, 8)}…`
                : "Unassigned"}
            </span>
          </>
        }
      />

      {actionError && (
        <div className="mb-4">
          <Notice tone="error" title="That did not go through">
            {actionError}
          </Notice>
        </div>
      )}

      {notice && (
        <div className="mb-4">
          <Notice tone={notice.tone} title={notice.title}>
            {notice.body}
          </Notice>
        </div>
      )}

      {blockedByOwnership && (
        <div className="mb-4">
          <Notice tone="warning" title="Another operator holds this ticket">
            You can read it, but not reply. Claim or release is not available to your role —
            ask an admin to reassign it, or pick another unassigned ticket.
          </Notice>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          <Panel title="Conversation" description={`${messages.length} message${messages.length === 1 ? "" : "s"}`}>
            <ul className="flex flex-col gap-3">
              {messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  isMine={message.authorType === "admin" && message.authorAdminEmail === identity?.email}
                />
              ))}
            </ul>
          </Panel>

          <Panel
            title={internal ? "Internal note" : "Reply"}
            description={
              internal
                ? "Visible to the team only. Never emailed, never shown to the customer."
                : "Emailed to the customer, who can read and reply in their thread."
            }
          >
            <div className="flex flex-col gap-3">
              <Textarea
                label=""
                rows={5}
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                placeholder={
                  internal
                    ? "What the next operator needs to know"
                    : "Answer the question, or say what you need from them"
                }
                disabled={!canReply || blockedByOwnership}
              />

              <label className="flex items-center gap-2 text-[11.5px] text-muted">
                <input
                  type="checkbox"
                  checked={internal}
                  onChange={(event) => setInternal(event.target.checked)}
                  disabled={!canReply || blockedByOwnership}
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                />
                Internal note (do not email the customer)
              </label>

              {!canReply ? (
                <p className="text-[11.5px] text-warning">
                  This ticket is closed. Reopen it from Update before replying.
                </p>
              ) : (
                <Button
                  size="sm"
                  className="self-start"
                  loading={mutations.reply.isPending}
                  disabled={!reply.trim() || blockedByOwnership}
                  onClick={submitReply}
                >
                  <Send size={13} aria-hidden />
                  {internal ? "Save note" : "Send reply"}
                </Button>
              )}
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel title="Requester">
            <div className="flex flex-col gap-2 text-[11.5px]">
              <span className="flex items-center gap-1.5 text-fg">
                <User size={13} aria-hidden />
                {ticket.requesterEmail}
              </span>

              {requester.userId ? (
                <>
                  <Link
                    href={`/users/${requester.userId}`}
                    className="text-accent transition-colors hover:text-fg"
                  >
                    Open account
                  </Link>
                  <span className="text-faint">
                    Plan: {requester.plan ?? "none"} · status {requester.status ?? "unknown"}
                  </span>
                </>
              ) : (
                <span className="text-faint">
                  No linked account — anonymous requester. They can still read the thread
                  through the emailed link.
                </span>
              )}
            </div>
          </Panel>

          <Panel title="Context" description="What the customer was looking at">
            <dl className="flex flex-col gap-2 text-[11.5px]">
              {context.page && (
                <Field
                  label="Page"
                  value={context.page}
                  external={context.page.startsWith("/") ? productUrl(context.page) : undefined}
                />
              )}

              {marketHref && (
                <Field
                  label="Market"
                  value={marketSlug ?? "Open in product"}
                  external={marketHref}
                  title={context.marketId}
                />
              )}

              {context.marketId && (
                <Field label="Market ID" value={context.marketId} mono />
              )}

              {context.analysisId && (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="shrink-0 text-faint">Analysis</dt>
                  <dd className="min-w-0 truncate text-right">
                    <button
                      type="button"
                      onClick={() => setAnalysisOpen(true)}
                      title="Show this analysis"
                      className="mono text-accent transition-colors hover:text-fg"
                    >
                      {context.analysisId.slice(0, 8)}… view
                    </button>
                  </dd>
                </div>
              )}

              <Field label="Session" value={context.sessionId} mono />
              <Field label="Recommendation" value={context.recommendation} />
              <Field label="Plan" value={context.plan} />
              <Field label="App version" value={context.appVersion} />
            </dl>
          </Panel>

          <Panel title="Audit" description="Every change is on the record">
            <dl className="flex flex-col gap-2 text-[11.5px] text-muted">
              <Field label="First reply" value={ticket.firstResponseAt ? formatDateTime(ticket.firstResponseAt) : "not yet"} />
              <Field label="Resolved" value={ticket.resolvedAt ? formatDateTime(ticket.resolvedAt) : "—"} />
              <Field label="Closed" value={ticket.closedAt ? formatDateTime(ticket.closedAt) : "—"} />
              <Field label="Confirmation" value={ticket.confirmationSent ? "email sent" : "not confirmed"} />
            </dl>
          </Panel>
        </div>
      </div>

      {context.analysisId && (
        <SupportAnalysisDialog
          analysisId={context.analysisId}
          open={analysisOpen}
          onClose={() => setAnalysisOpen(false)}
        />
      )}

      <Dialog
        open={updateOpen}
        onClose={() => setUpdateOpen(false)}
        title={`Update ${ticket.ref}`}
        description="Status, priority and assignment require a reason — it lands in the audit log."
        onSubmit={(event) => {
          event.preventDefault();
          submitUpdate();
        }}
        dismissible={!mutations.update.isPending}
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setUpdateOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              loading={mutations.update.isPending}
              disabled={reason.trim().length < 8}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[11.5px] text-muted">
            Status
            <select
              value={nextStatus}
              onChange={(event) => setNextStatus(event.target.value)}
              className="h-8 rounded-[6px] border border-border-strong/70 bg-field px-2 text-[12px] text-fg focus:border-accent focus:outline-none"
            >
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[11.5px] text-muted">
            Priority
            <select
              value={nextPriority}
              onChange={(event) => setNextPriority(event.target.value)}
              className="h-8 rounded-[6px] border border-border-strong/70 bg-field px-2 text-[12px] text-fg focus:border-accent focus:outline-none"
            >
              {PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          {isAdmin && (
            <Input
              label="Assignee (Cognito sub, blank to release)"
              value={nextAssignee}
              onChange={(event) => setNextAssignee(event.target.value)}
              hint="Admins can move a ticket between operators."
            />
          )}

          <Input
            label="Reason (recorded in the audit log)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why are you making this change?"
            hint="At least 8 characters. Recorded with your name."
          />
        </div>
      </Dialog>
    </Page>
  );
}

function Field({
  label,
  value,
  mono = false,
  external,
  title,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  /** Absolute URL opened in a new tab (the customer app). */
  external?: string;
  title?: string;
}) {
  if (!value) return null;

  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-faint">{label}</dt>
      <dd
        className={`min-w-0 truncate text-right text-fg ${mono ? "mono" : ""}`}
        title={title ?? value}
      >
        {external ? (
          <a
            href={external}
            target="_blank"
            rel="noreferrer"
            className="text-accent transition-colors hover:text-fg"
          >
            {value.length > 28 ? `${value.slice(0, 26)}…` : value}
          </a>
        ) : value.length > 28 ? (
          `${value.slice(0, 26)}…`
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function MessageBubble({ message, isMine }: { message: SupportMessage; isMine: boolean }) {
  const isCustomer = message.authorType === "customer";

  return (
    <li>
      <div
        className={[
          "rounded-[8px] border px-3 py-2.5",
          message.isInternal
            ? "border-warning/40 bg-warning/10"
            : isCustomer
              ? "border-border bg-surface-2/40"
              : "border-accent/30 bg-accent/5",
        ].join(" ")}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-fg">
            {message.isInternal ? (
              <>
                <Lock size={11} aria-hidden />
                Internal note
                {message.authorAdminEmail ? ` · ${message.authorAdminEmail}` : ""}
              </>
            ) : isCustomer ? (
              "Customer"
            ) : (
              <>
                <Bot size={11} aria-hidden />
                {isMine ? "You" : (message.authorAdminEmail ?? "Support")}
              </>
            )}
          </span>
          <time className="text-[10.5px] text-faint">{formatDateTime(message.createdAt)}</time>
        </div>

        <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed text-fg">
          {message.body}
        </p>
      </div>
    </li>
  );
}
