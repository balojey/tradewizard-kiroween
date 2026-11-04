"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { DataTable, type Column } from "@/components/data/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/Stat";
import { useCursorStack } from "@/hooks/useCursorStack";
import { useCampaigns, useNewsletterMutations, useNewsletterSummary } from "@/hooks/useNewsletter";
import { formatDateTime } from "@/lib/format";
import type { NewsletterCampaign } from "@/types/admin";

const STATUS_TONE: Record<
  NewsletterCampaign["status"],
  "neutral" | "accent" | "yes" | "no" | "warning"
> = {
  draft: "neutral",
  sending: "accent",
  sent: "yes",
  failed: "no",
  cancelled: "warning",
};

const STARTER = {
  subject: "The Weekly Brief",
  preheader: "What the agents moved on this week",
  template: "market_brief" as const,
  content: {
    heroTitle: "This week on TradeWizard",
    intro:
      "A short note on what the agents saw, which calls worked, and what we got wrong.",
    picks: [
      {
        question: "Add your first market",
        aiProbability: 60,
        marketProbability: 50,
        read: "Replace this with what the agents concluded.",
        url: "",
      },
    ],
    closing: "See you next week.",
  },
};

export function CampaignsView() {
  const router = useRouter();
  const { data: summary } = useNewsletterSummary();
  const [status, setStatus] = useState("");
  const resetKey = status;
  const cursorStack = useCursorStack(resetKey);
  const { data, isLoading } = useCampaigns({ status }, cursorStack.cursor);

  const mutations = useNewsletterMutations("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startCampaign() {
    setCreating(true);
    setError(null);

    mutations.create.mutate(
      { ...STARTER, reason: "Starting a new newsletter issue" },
      {
        onSuccess: (campaign) => router.push(`/newsletter/${campaign.id}`),
        onError: (caught) => {
          setError(caught.message);
          setCreating(false);
        },
      }
    );
  }

  const columns: Column<NewsletterCampaign>[] = [
    {
      key: "subject",
      header: "Issue",
      render: (row) => (
        <span className="block max-w-[420px]">
          <span className="block truncate text-fg">{row.subject}</span>
          <span className="mt-0.5 block text-[10.5px] text-faint">{row.template}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>,
    },
    {
      key: "recipients",
      header: "Recipients",
      align: "right",
      render: (row) => <span className="num">{row.recipientCount}</span>,
    },
    {
      key: "sent",
      header: "Sent",
      align: "right",
      render: (row) => (
        <span className="num">
          {row.sentCount}
          {row.failedCount > 0 ? <span className="text-no"> · {row.failedCount} failed</span> : null}
        </span>
      ),
    },
    {
      key: "created",
      header: "Created",
      align: "right",
      render: (row) => (
        <span className="text-[11px] text-muted">{formatDateTime(row.createdAt)}</span>
      ),
    },
  ];

  return (
    <Page>
      <PageHeader
        title="Newsletter"
        description="One editorial issue at a time. Sending is owner-only; previews and test sends use the same renderer as the real send."
        actions={
          <>
            <Link
              href="/newsletter/subscribers"
              className="inline-flex h-7 items-center rounded-[6px] border border-border-strong/60 px-2.5 text-[11px] text-muted transition-colors hover:text-fg"
            >
              Subscribers
            </Link>
            <Button size="sm" loading={creating} onClick={startCampaign}>
              New issue
            </Button>
          </>
        }
        meta={
          summary ? (
            <>
              <span>{summary.subscribers} confirmed subscribers</span>
              <span>·</span>
              <span>{summary.drafts} drafts</span>
              {summary.sending > 0 && (
                <>
                  <span>·</span>
                  <span className="text-accent">{summary.sending} sending</span>
                </>
              )}
              <span>·</span>
              <span>{summary.sent} sent</span>
            </>
          ) : null
        }
      />

      {error && (
        <div className="mb-4 rounded-[8px] border border-no/30 bg-no/10 px-3 py-2 text-[11.5px] text-no">
          {error}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="Subscribers" value={summary?.subscribers ?? "—"} hint="Explicitly opted in" />
        <StatCard label="Drafts" value={summary?.drafts ?? "—"} hint="Not sent yet" />
        <StatCard label="Sending" value={summary?.sending ?? "—"} hint="In flight now" />
        <StatCard label="Sent" value={summary?.sent ?? "—"} hint="Completed issues" />
      </div>

      <div className="mb-3 flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-faint">
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-7 rounded-[6px] border border-border-strong/60 bg-field px-2 text-[11.5px] text-fg focus:border-accent focus:outline-none"
          >
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="sending">Sending</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
      </div>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        getRowHref={(row) => `/newsletter/${row.id}`}
        loading={isLoading}
        emptyMessage="No issues yet."
        emptyHint="New issue starts a draft you can preview and test before sending."
      />

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={cursorStack.prev}
          disabled={!cursorStack.canPrev}
          className="h-7 rounded-[6px] border border-border-strong/60 px-2.5 text-[11px] text-muted transition-colors hover:text-fg disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => {
            const next = data?.nextCursor;
            if (next) cursorStack.next(next);
          }}
          disabled={!data?.nextCursor}
          className="h-7 rounded-[6px] border border-border-strong/60 px-2.5 text-[11px] text-muted transition-colors hover:text-fg disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </Page>
  );
}
