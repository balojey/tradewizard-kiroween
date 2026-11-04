"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, MailCheck, Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  newRequestId,
  submitSupportTicket,
  supportErrorMessage,
  type SupportSubmitResult,
  type SupportTopic,
} from "@/lib/support-client";
import { CopyReference } from "./CopyReference";
import { SUPPORT_TOPICS, topicMeta } from "./support-status";
import { cn } from "@/utils/classNames";

export interface SupportContextChip {
  label: string;
  value: string;
}

export interface SupportFormProps {
  defaultEmail?: string;
  /** Verified account email: the field is hidden and submissions use this. */
  lockedEmail?: string;
  defaultTopic?: SupportTopic;
  /** Whitelisted context sent to the API; the server drops unknown keys. */
  context?: Record<string, string>;
  /** Human-readable pairing of the same context, shown before sending. */
  contextSummary?: SupportContextChip[];
  onSubmitted?: (ref: string) => void;
}

const FIELD =
  "w-full rounded-lg border border-border bg-bg px-3.5 py-2.5 text-sm text-fg " +
  "placeholder:text-muted outline-none transition-[border-color,box-shadow] " +
  "focus:border-ai focus:ring-2 focus:ring-ai/20 disabled:opacity-60";

const LABEL = "mb-1.5 block text-xs font-medium text-muted";

function Receipt({
  result,
  email,
  topic,
  signedIn,
}: {
  result: SupportSubmitResult;
  email: string;
  topic: SupportTopic;
  signedIn: boolean;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const about = topicMeta(topic);

  return (
    <div role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-yes/30 bg-yes/10">
          <CheckCircle2 className="h-5 w-5 text-yes" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="font-display text-lg font-bold outline-none"
          >
            Request received
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            We saved it and gave it a reference. Everything about it now lives in
            one private conversation.
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-bg px-3.5 py-3">
        <div>
          <p className="text-[0.62rem] uppercase tracking-[0.08em] text-muted">
            Reference
          </p>
          <p className="mt-0.5 font-mono text-base tracking-wide text-fg">{result.ref}</p>
        </div>
        <CopyReference value={result.ref} />
      </div>

      {result.duplicate && (
        <p className="mt-3 text-xs leading-relaxed text-muted">
          This matched a request you sent moments ago, so we kept the original
          instead of opening a second one.
        </p>
      )}

      {result.emailSent ? (
        <div className="mt-3 rounded-lg border border-border bg-surface px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-fg">
            <MailCheck className="h-3.5 w-3.5 text-yes" aria-hidden="true" />
            Check {email}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            We emailed a private link. It is how you read our reply and add more
            detail — keep it. If it does not arrive in a few minutes, look in spam
            before sending a new request.
          </p>
        </div>
      ) : (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-3">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-warning"
            aria-hidden="true"
          />
          <p className="text-xs leading-relaxed text-fg">
            Your request is saved, but the confirmation email did not go out. We
            can still see it under <span className="font-mono">{result.ref}</span>;
            if you hear nothing, send it again or contact us from the Help page.
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {signedIn && (
          <Link href="/account/support">
            <Button size="sm" variant="secondary">
              Your requests
            </Button>
          </Link>
        )}
        <span className="text-[0.68rem] text-muted">{about.label} · we reply by email</span>
      </div>
    </div>
  );
}

export function SupportForm({
  defaultEmail = "",
  lockedEmail,
  defaultTopic = "other",
  context,
  contextSummary,
  onSubmitted,
}: SupportFormProps) {
  const ids = useId();
  const [email, setEmail] = useState(defaultEmail);
  const [topic, setTopic] = useState<SupportTopic>(defaultTopic);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SupportSubmitResult | null>(null);

  // One id per mount: a double submit returns the same ticket instead of two.
  const [requestId] = useState(newRequestId);

  const effectiveEmail = (lockedEmail ?? email).trim();
  const nearLimit = body.length > 3600;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const submitted = await submitSupportTicket({
        email: effectiveEmail,
        topic,
        subject: subject.trim(),
        body: body.trim(),
        context,
        requestId,
      });

      setResult(submitted);
      onSubmitted?.(submitted.ref);
    } catch (caught) {
      setError(supportErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Receipt
        result={result}
        email={effectiveEmail}
        topic={topic}
        signedIn={Boolean(lockedEmail)}
      />
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {lockedEmail ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3.5 py-2.5">
          <MailCheck className="h-4 w-4 shrink-0 text-yes" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-[0.65rem] uppercase tracking-[0.06em] text-muted">
              We&apos;ll reply to
            </p>
            <p className="truncate text-sm text-fg">{lockedEmail}</p>
          </div>
          <Badge tone="yes" size="sm">
            verified
          </Badge>
        </div>
      ) : (
        <div>
          <label htmlFor={`${ids}-email`} className={LABEL}>
            Your email
          </label>
          <input
            id={`${ids}-email`}
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className={FIELD}
            disabled={busy}
          />
          <p className="mt-1 text-[0.7rem] text-muted">
            We reply here and nowhere else, so use an address you can open.
          </p>
        </div>
      )}

      {contextSummary && contextSummary.length > 0 && (
        <div className="rounded-lg border border-ai/25 bg-ai/[0.06] px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-[0.7rem] font-medium text-ai">
            <Paperclip className="h-3 w-3" aria-hidden="true" />
            Attached to this request
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {contextSummary.map((chip) => (
              <li
                key={chip.label}
                className="max-w-full truncate rounded-md border border-border bg-bg/70 px-2 py-1 text-[0.7rem] text-fg"
                title={`${chip.label}: ${chip.value}`}
              >
                <span className="text-muted">{chip.label}:</span> {chip.value}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[0.65rem] leading-relaxed text-muted">
            We attach this so you do not have to describe where you were.
          </p>
        </div>
      )}

      <fieldset>
        <legend className={LABEL}>What is this about?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {SUPPORT_TOPICS.map((option) => {
            const Icon = option.icon;
            const selected = topic === option.value;

            return (
              <label
                key={option.value}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors",
                  selected
                    ? "border-accent/50 bg-accent/10"
                    : "border-border bg-bg hover:border-border-strong"
                )}
              >
                <input
                  type="radio"
                  name="support-topic"
                  value={option.value}
                  checked={selected}
                  onChange={() => setTopic(option.value)}
                  className="sr-only"
                  disabled={busy}
                />
                <Icon
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0",
                    selected ? "text-accent" : "text-muted"
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-fg">{option.label}</span>
                  <span className="mt-0.5 block truncate text-[0.65rem] text-muted">
                    {option.hint}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label htmlFor={`${ids}-subject`} className={LABEL}>
          Subject
        </label>
        <input
          id={`${ids}-subject`}
          type="text"
          required
          minLength={5}
          maxLength={140}
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="One line describing the problem"
          className={FIELD}
          disabled={busy}
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <label htmlFor={`${ids}-body`} className="text-xs font-medium text-muted">
            What happened?
          </label>
          <span
            className={cn(
              "text-[0.65rem] tabular-nums",
              nearLimit ? "text-warning" : "text-muted"
            )}
          >
            {body.length}/4000
          </span>
        </div>
        <textarea
          id={`${ids}-body`}
          required
          minLength={20}
          maxLength={4000}
          rows={6}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="What you expected, what happened instead, and anything you had already tried."
          className={cn(FIELD, "resize-y leading-relaxed")}
          disabled={busy}
        />
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-no/30 bg-no/10 px-3.5 py-3"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-no" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-fg">{error}</p>
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[0.7rem] leading-relaxed text-muted">
          We reply by email. Your request keeps its own private link.
        </p>
        <Button type="submit" loading={busy} className="max-[430px]:w-full sm:w-auto">
          Send request
        </Button>
      </div>
    </form>
  );
}
