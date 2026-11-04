"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input, Textarea } from "@/components/ui/Input";
import { Notice } from "@/components/ui/Notice";
import { ReauthNotice, errorMessage, isReauthRequired } from "@/components/auth/ReauthNotice";
import { useAdminMe } from "@/hooks/useAdminMe";
import { useCampaign, useNewsletterMutations, useNewsletterSummary } from "@/hooks/useNewsletter";
import { hasRole } from "@/constants/roles";
import { formatDateTime } from "@/lib/format";
import type {
  MarketBriefContent,
  NewsletterCampaign,
  NewsletterContent,
  ProductUpdateContent,
} from "@/types/admin";

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

export function CampaignComposer() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data, isLoading, error } = useCampaign(id);
  const campaign = data?.campaign;

  if (isLoading || (!campaign && !error)) {
    return (
      <Page>
        <div className="h-6 w-52 animate-pulse rounded bg-surface-2" />
        <div className="mt-4 h-64 animate-pulse rounded bg-surface-2" />
      </Page>
    );
  }

  if (error || !campaign) {
    return (
      <Page>
        <Notice tone="error" title="Could not load this campaign">
          {error instanceof Error ? error.message : "It may have been deleted."}
        </Notice>
      </Page>
    );
  }

  // Keyed remount is the clean way to reset the editor when the campaign changes:
  // no hydration effect, and refetches cannot overwrite what is being typed.
  return <CampaignEditor key={campaign.id} campaign={campaign} />;
}

function CampaignEditor({ campaign }: { campaign: NewsletterCampaign }) {
  const id = campaign.id;
  const { data: summary } = useNewsletterSummary();
  const { data: identity } = useAdminMe();
  const mutations = useNewsletterMutations(id);

  const [subject, setSubject] = useState(campaign.subject);
  const [preheader, setPreheader] = useState(campaign.preheader ?? "");
  const [template, setTemplate] = useState<NewsletterCampaign["template"]>(campaign.template);
  const [content, setContent] = useState<NewsletterContent>(campaign.content);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "error"; title: string; body?: string } | null>(null);

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveReason, setSaveReason] = useState("Editing the draft");
  const [sendOpen, setSendOpen] = useState(false);
  const [sendReason, setSendReason] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const draft = useMemo(
    () => ({
      subject,
      preheader,
      template,
      content,
    }),
    [subject, preheader, template, content]
  );

  const marketContent = content as MarketBriefContent;
  const productContent = content as ProductUpdateContent;

  const isDraft = campaign.status === "draft";
  const isOwner = identity ? hasRole(identity.role, "owner") : false;
  const dirty =
    campaign.subject !== subject ||
    (campaign.preheader ?? "") !== preheader ||
    JSON.stringify(campaign.content) !== JSON.stringify(content);

  function refreshPreview() {
    mutations.preview.mutate(draft, {
      onSuccess: (result) => setPreviewHtml(result.html),
      onError: (caught) => setNotice({ tone: "error", title: "Preview failed", body: caught.message }),
    });
  }

  function save() {
    mutations.update.mutate(
      { ...draft, reason: saveReason },
      {
        onSuccess: () => {
          setSaveOpen(false);
          setNotice({ tone: "success", title: "Draft saved" });
        },
        onError: (caught) => setNotice({ tone: "error", title: "Could not save", body: caught.message }),
      }
    );
  }

  return (
    <Page>
      <PageHeader
        crumbs={[{ label: "Newsletter", href: "/newsletter" }, { label: "Issue" }]}
        title={subject || "Untitled issue"}
        description={<>Created {formatDateTime(campaign.createdAt)} · {campaign.template}</>}
        actions={
          <>
            <Button size="sm" variant="secondary" loading={mutations.preview.isPending} onClick={refreshPreview}>
              Refresh preview
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={mutations.test.isPending}
              disabled={dirty}
              onClick={() =>
                mutations.test.mutate(undefined, {
                  onSuccess: (result) =>
                    setNotice({
                      tone: "success",
                      title: "Test sent",
                      body: `Check ${result.sentTo}. Test sends use the saved draft.`,
                    }),
                  onError: (caught) => setNotice({ tone: "error", title: "Test send failed", body: caught.message }),
                })
              }
            >
              Test to me
            </Button>
            {isDraft && (
              <Button size="sm" variant="secondary" onClick={() => setSaveOpen(true)}>
                Save draft
              </Button>
            )}
            {isDraft && isOwner && (
              <Button size="sm" onClick={() => setSendOpen(true)}>
                Send issue
              </Button>
            )}
            {(campaign.status === "sending" || campaign.status === "draft") && isOwner && (
              <Button size="sm" variant="danger" onClick={() => setCancelOpen(true)}>
                Cancel
              </Button>
            )}
          </>
        }
        meta={
          <>
            <Badge tone={STATUS_TONE[campaign.status]}>{campaign.status}</Badge>
            <span>{campaign.recipientCount} recipients</span>
            <span>·</span>
            <span>{campaign.sentCount} sent</span>
            {campaign.failedCount > 0 && (
              <>
                <span>·</span>
                <span className="text-no">{campaign.failedCount} failed</span>
              </>
            )}
            {summary && (
              <>
                <span>·</span>
                <span>{summary.subscribers} confirmed subscribers</span>
              </>
            )}
            {dirty && campaign.status === "draft" && (
              <>
                <span>·</span>
                <span className="text-warning">unsaved changes</span>
              </>
            )}
          </>
        }
      />

      {notice && (
        <div className="mb-4">
          <Notice tone={notice.tone} title={notice.title}>
            {notice.body}
          </Notice>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Panel title="Issue" description="Subject and framing">
            <div className="flex flex-col gap-3">
              <Input
                label="Subject"
                value={subject}
                maxLength={140}
                disabled={!isDraft}
                onChange={(event) => setSubject(event.target.value)}
                hint="What lands in the inbox."
              />
              <Input
                label="Preheader"
                value={preheader}
                maxLength={140}
                disabled={!isDraft}
                onChange={(event) => setPreheader(event.target.value)}
                hint="The grey line next to the subject in most clients."
              />
              <label className="flex flex-col gap-1 text-[11.5px] text-muted">
                Template
                <select
                  value={template}
                  disabled={!isDraft}
                  onChange={(event) => {
                    const next = event.target.value as NewsletterCampaign["template"];
                    setTemplate(next);
                    setContent(
                      next === "market_brief" ? STARTER_MARKET : STARTER_PRODUCT
                    );
                  }}
                  className="h-8 rounded-[6px] border border-border-strong/70 bg-field px-2 text-[12px] text-fg focus:border-accent focus:outline-none"
                >
                  <option value="market_brief">Market brief</option>
                  <option value="product_update">Product update</option>
                </select>
              </label>

              <Input
                label="Headline"
                value={content.heroTitle}
                maxLength={90}
                disabled={!isDraft}
                onChange={(event) => setContent({ ...content, heroTitle: event.target.value })}
              />
              <Textarea
                label="Introduction"
                rows={4}
                maxLength={600}
                value={content.intro}
                disabled={!isDraft}
                onChange={(event) => setContent({ ...content, intro: event.target.value })}
              />
            </div>
          </Panel>

          <Panel
            title={template === "market_brief" ? "Markets" : "Sections"}
            description={
              template === "market_brief"
                ? "One to four. The bar compares the agents' fair probability with the market's."
                : "One to three short sections. Each may carry a single call to action."
            }
          >
            {template === "market_brief" ? (
              <MarketsEditor
                content={marketContent}
                disabled={!isDraft}
                onChange={setContent}
              />
            ) : (
              <SectionsEditor
                content={productContent}
                disabled={!isDraft}
                onChange={setContent}
              />
            )}

            <Textarea
              label="Closing note"
              rows={3}
              maxLength={500}
              value={content.closing ?? ""}
              disabled={!isDraft}
              onChange={(event) => setContent({ ...content, closing: event.target.value })}
              hint="Optional. One honest line works better than a call to action."
            />
          </Panel>
        </div>

        <Panel
          title="Preview"
          description="Rendered by the same module that sends. Images blocked is the default state."
          actions={
            <Button
              size="sm"
              variant="ghost"
              loading={mutations.preview.isPending}
              onClick={refreshPreview}
            >
              Render
            </Button>
          }
        >
          {previewHtml ? (
            <iframe
              title="Newsletter preview"
              srcDoc={previewHtml}
              sandbox=""
              className="h-[720px] w-full rounded-[8px] border border-border bg-white"
            />
          ) : (
            <div className="flex h-[320px] items-center justify-center rounded-[8px] border border-dashed border-border text-[11.5px] text-faint">
              Press Render to preview the saved draft.
            </div>
          )}
        </Panel>
      </div>

      {/* Save draft */}
      <Dialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Save draft"
        description="Draft edits are audited too, so say what changed."
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        dismissible={!mutations.update.isPending}
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={mutations.update.isPending} disabled={saveReason.trim().length < 8}>
              Save
            </Button>
          </>
        }
      >
        <Input
          label="Reason (recorded in the audit log)"
          value={saveReason}
          onChange={(event) => setSaveReason(event.target.value)}
          hint="At least 8 characters. Recorded with your name."
        />
      </Dialog>

      {/* Send */}
      <Dialog
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        title="Send this issue?"
        description={`This emails ${summary?.subscribers ?? 0} confirmed subscribers. It cannot be undone.`}
        onSubmit={(event) => {
          event.preventDefault();
          mutations.send.mutate(sendReason, {
            onSuccess: (result) => {
              setSendOpen(false);
              setNotice({
                tone: "success",
                title: "Sending started",
                body: `${result.recipients} recipients snapshotted. Progress refreshes every few seconds.`,
              });
            },
            onError: (caught) =>
              setNotice({
                tone: isReauthRequired(caught) ? "warning" : "error",
                title: "Could not send",
                body: isReauthRequired(caught) ? undefined : caught.message,
              }),
          });
        }}
        dismissible={!mutations.send.isPending}
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setSendOpen(false)}>
              Not yet
            </Button>
            <Button
              type="submit"
              size="sm"
              loading={mutations.send.isPending}
              disabled={sendReason.trim().length < 8}
            >
              Send to {summary?.subscribers ?? 0}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <ReauthNotice error={mutations.send.error} />
          <Input
            label="Reason (recorded in the audit log)"
            value={sendReason}
            onChange={(event) => setSendReason(event.target.value)}
            placeholder="Why are you sending this now?"
            hint="At least 8 characters."
          />
          <p className="text-[11px] leading-relaxed text-muted">
            Anyone who unsubscribes during the send is skipped. A systemic failure stops
            the campaign rather than continuing through the list.
          </p>
          {errorMessage(mutations.send.error) && !isReauthRequired(mutations.send.error) && (
            <p className="text-[11px] text-no">{errorMessage(mutations.send.error)}</p>
          )}
        </div>
      </Dialog>

      {/* Cancel */}
      <Dialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this campaign?"
        description="Queued deliveries are skipped. Anything already sent stays sent."
        onSubmit={(event) => {
          event.preventDefault();
          mutations.cancel.mutate(cancelReason, {
            onSuccess: () => {
              setCancelOpen(false);
              setNotice({ tone: "warning", title: "Campaign cancelled" });
            },
            onError: (caught) =>
              setNotice({ tone: "error", title: "Could not cancel", body: caught.message }),
          });
        }}
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setCancelOpen(false)}>
              Keep it
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="danger"
              loading={mutations.cancel.isPending}
              disabled={cancelReason.trim().length < 8}
            >
              Cancel campaign
            </Button>
          </>
        }
      >
        <Input
          label="Reason (recorded in the audit log)"
          value={cancelReason}
          onChange={(event) => setCancelReason(event.target.value)}
          hint="At least 8 characters."
        />
      </Dialog>

      <p className="mt-4 text-[11px] text-faint">
        <Link href="/newsletter" className="text-accent hover:text-fg">
          Back to all issues
        </Link>
        {campaign.approvedBy ? ` · approved by ${campaign.approvedBy}` : ""}
      </p>
    </Page>
  );

}

// ─── Template editors ───────────────────────────────────────────────────────

const STARTER_MARKET: MarketBriefContent = {
  heroTitle: "This week on TradeWizard",
  intro: "A short note on what the agents saw, which calls worked, and what we got wrong.",
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
};

const STARTER_PRODUCT: ProductUpdateContent = {
  heroTitle: "What we shipped this week",
  intro: "One short update on what changed in TradeWizard and why it matters to you.",
  sections: [
    {
      heading: "Add your first section",
      body: "Describe what changed, in plain language, and what the reader can now do.",
      ctaLabel: "Take a look",
      ctaUrl: "https://tradewizard.live",
    },
  ],
  closing: "More next week.",
};

function MarketsEditor({
  content,
  disabled,
  onChange,
}: {
  content: MarketBriefContent;
  disabled: boolean;
  onChange: (next: NewsletterContent) => void;
}) {
  function update(index: number, patch: Partial<MarketBriefContent["picks"][number]>) {
    onChange({
      ...content,
      picks: content.picks.map((pick, i) => (i === index ? { ...pick, ...patch } : pick)),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {content.picks.map((pick, index) => (
        <div key={index} className="rounded-[8px] border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted">Market {index + 1}</span>
            {!disabled && content.picks.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  onChange({ ...content, picks: content.picks.filter((_, i) => i !== index) })
                }
                className="text-[11px] text-no hover:underline"
              >
                Remove
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Input
              label="Question"
              value={pick.question}
              maxLength={160}
              disabled={disabled}
              onChange={(event) => update(index, { question: event.target.value })}
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                label="AI fair %"
                type="number"
                min={0}
                max={100}
                value={String(pick.aiProbability)}
                disabled={disabled}
                onChange={(event) => update(index, { aiProbability: Number(event.target.value) })}
              />
              <Input
                label="Market %"
                type="number"
                min={0}
                max={100}
                value={String(pick.marketProbability)}
                disabled={disabled}
                onChange={(event) =>
                  update(index, { marketProbability: Number(event.target.value) })
                }
              />
            </div>
            <Textarea
              label="What the agents concluded"
              rows={2}
              maxLength={240}
              value={pick.read}
              disabled={disabled}
              onChange={(event) => update(index, { read: event.target.value })}
            />
            <Input
              label="Link (optional)"
              value={pick.url ?? ""}
              disabled={disabled}
              placeholder="https://tradewizard.live/markets/…"
              onChange={(event) => update(index, { url: event.target.value })}
            />
          </div>
        </div>
      ))}

      {!disabled && content.picks.length < 4 && (
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          onClick={() =>
            onChange({
              ...content,
              picks: [
                ...content.picks,
                { question: "", aiProbability: 50, marketProbability: 50, read: "", url: "" },
              ],
            })
          }
        >
          Add market
        </Button>
      )}
    </div>
  );
}

function SectionsEditor({
  content,
  disabled,
  onChange,
}: {
  content: ProductUpdateContent;
  disabled: boolean;
  onChange: (next: NewsletterContent) => void;
}) {
  function update(index: number, patch: Partial<ProductUpdateContent["sections"][number]>) {
    onChange({
      ...content,
      sections: content.sections.map((section, i) =>
        i === index ? { ...section, ...patch } : section
      ),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {content.sections.map((section, index) => (
        <div key={index} className="rounded-[8px] border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted">Section {index + 1}</span>
            {!disabled && content.sections.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...content,
                    sections: content.sections.filter((_, i) => i !== index),
                  })
                }
                className="text-[11px] text-no hover:underline"
              >
                Remove
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Input
              label="Heading"
              value={section.heading}
              maxLength={110}
              disabled={disabled}
              onChange={(event) => update(index, { heading: event.target.value })}
            />
            <Textarea
              label="Body"
              rows={3}
              maxLength={700}
              value={section.body}
              disabled={disabled}
              onChange={(event) => update(index, { body: event.target.value })}
            />
            <Input
              label="Button label (optional)"
              value={section.ctaLabel ?? ""}
              maxLength={40}
              disabled={disabled}
              onChange={(event) => update(index, { ctaLabel: event.target.value })}
            />
            <Input
              label="Button link (optional)"
              value={section.ctaUrl ?? ""}
              disabled={disabled}
              placeholder="https://tradewizard.live/…"
              onChange={(event) => update(index, { ctaUrl: event.target.value })}
            />
          </div>
        </div>
      ))}

      {!disabled && content.sections.length < 3 && (
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          onClick={() =>
            onChange({
              ...content,
              sections: [
                ...content.sections,
                { heading: "", body: "", ctaLabel: "", ctaUrl: "" },
              ],
            })
          }
        >
          Add section
        </Button>
      )}
    </div>
  );
}
