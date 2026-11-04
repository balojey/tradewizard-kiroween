"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, LifeBuoy, Plus, RotateCcw } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { SUPPORT_STATUS, topicMeta } from "@/components/support/support-status";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { listMySupportTickets, type SupportTicketSummary } from "@/lib/support-client";

function formatAbsolute(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Relative age for scanning; exact time in the tooltip. */
function formatRelative(value: string): string {
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function TicketRow({ ticket }: { ticket: SupportTicketSummary }) {
  const status = SUPPORT_STATUS[ticket.status];
  const topic = topicMeta(ticket.topic);
  const Icon = topic.icon;

  return (
    <li>
      <Link
        href={`/help/t/${ticket.ref}`}
        className="group flex items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3.5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-md)]"
      >
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-muted transition-colors group-hover:text-fg">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 truncate text-sm font-medium text-fg">
              {ticket.subject}
            </span>
            <Badge tone={status.tone} size="sm">
              {status.label}
            </Badge>
          </div>

          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.68rem] text-muted">
            <span className="font-mono">{ticket.ref}</span>
            <span aria-hidden="true">·</span>
            <span>{topic.label}</span>
            <span aria-hidden="true">·</span>
            <span title={formatAbsolute(ticket.lastMessageAt)}>
              updated {formatRelative(ticket.lastMessageAt)}
            </span>
          </p>
        </div>

        <ChevronRight
          className="mt-2 h-4 w-4 shrink-0 text-muted transition-[color,transform] duration-200 group-hover:translate-x-0.5 group-hover:text-fg"
          aria-hidden="true"
        />
      </Link>
    </li>
  );
}

export default function SupportRequestsPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["support", "mine"],
    queryFn: listMySupportTickets,
    retry: false,
  });

  const items = data?.items ?? [];

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[860px]">
        <Link
          href="/account"
          className="mb-4 inline-flex items-center gap-1 text-[0.7rem] text-muted transition-colors hover:text-fg"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          Account
        </Link>

        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl font-bold">Support requests</h1>
              {items.length > 0 && (
                <Badge tone="muted" size="sm">
                  {items.length}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Requests you opened while signed in. Replies also arrive by email, and
              each request keeps one private conversation link.
            </p>
          </div>

          <Link href="/help">
            <Button size="sm">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              New request
            </Button>
          </Link>
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                className="flex items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3.5"
              >
                <Skeleton className="h-9 w-9 rounded-lg" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="mt-2 h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <Card className="p-5">
            <p className="text-sm font-medium text-fg">Could not load your requests</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {error instanceof Error ? error.message : "Please try again shortly."}
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-4"
              loading={isFetching}
              onClick={() => void refetch()}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Try again
            </Button>
          </Card>
        ) : items.length === 0 ? (
          <Card className="p-2">
            <EmptyState
              icon={LifeBuoy}
              title="No support requests yet"
              description="If something looks wrong in an analysis or a Portfolio Manager session, tell us and we'll investigate with the exact context attached."
              action={
                <Link href="/help">
                  <Button size="sm">Contact support</Button>
                </Link>
              }
            />
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((ticket) => (
              <TicketRow key={ticket.ref} ticket={ticket} />
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
