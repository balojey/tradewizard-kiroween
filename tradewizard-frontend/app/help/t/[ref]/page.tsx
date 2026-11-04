"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Info,
  LifeBuoy,
  Link2Off,
  Lock,
  RotateCcw,
  User,
} from "lucide-react";
import { HelpShell } from "@/components/support/HelpShell";
import { CopyReference } from "@/components/support/CopyReference";
import { SUPPORT_STATUS, topicMeta } from "@/components/support/support-status";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import {
  getSupportThread,
  newRequestId,
  postSupportMessage,
  supportErrorMessage,
  SupportApiError,
  type SupportThread,
  type SupportThreadMessage,
} from "@/lib/support-client";
import { cn } from "@/utils/classNames";

const STATUS_BOX = {
  accent: "border-accent/25 bg-accent/[0.07]",
  warning: "border-warning/25 bg-warning/[0.08]",
  yes: "border-yes/25 bg-yes/[0.06]",
  muted: "border-border bg-surface",
} as const;

const STATUS_DOT = {
  accent: "bg-accent",
  warning: "bg-warning",
  yes: "bg-yes",
  muted: "bg-muted",
} as const;

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function Message({ message }: { message: SupportThreadMessage }) {
  const fromTeam = message.author === "admin";

  if (message.author === "system") {
    return (
      <li className="flex items-start gap-2 px-1 text-[0.68rem] leading-relaxed text-muted">
        <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        <span>
          {message.body}
          <span className="ml-1.5 opacity-70">· {formatTimestamp(message.createdAt)}</span>
        </span>
      </li>
    );
  }

  return (
    <li className="flex gap-3">
      <span
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
          fromTeam
            ? "border-accent/30 bg-accent/10 text-accent"
            : "border-border bg-surface-2 text-muted"
        )}
        aria-hidden="true"
      >
        {fromTeam ? <LifeBuoy className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
      </span>

      <Card
        className={cn(
          "min-w-0 flex-1 p-4",
          fromTeam && "border-accent/25 bg-accent/[0.05]"
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-[0.7rem] font-semibold text-fg">
            {fromTeam ? "TradeWizard Support" : "You"}
          </span>
          <time dateTime={message.createdAt} className="text-[0.65rem] text-muted">
            {formatTimestamp(message.createdAt)}
          </time>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-fg">
          {message.body}
        </p>
      </Card>
    </li>
  );
}

function ThreadContent() {
  const params = useParams<{ ref: string }>();
  const search = useSearchParams();
  const ref = params.ref;
  const token = search.get("t");
  const { isAuthenticated } = useAuth();

  const [thread, setThread] = useState<SupportThread | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [reply, setReply] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const requestId = useRef(newRequestId());
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    setState("loading");

    getSupportThread(ref, token)
      .then((loaded) => {
        if (cancelled) return;
        setThread(loaded);
        setState("ready");
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        if (caught instanceof SupportApiError && caught.status === 404) {
          setState("missing");
          return;
        }
        setError(supportErrorMessage(caught));
        setState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [attempt, ref, token]);

  const sendReply = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (sending || !reply.trim()) return;

      setSending(true);
      setReplyError(null);
      setSent(false);

      try {
        const message: SupportThreadMessage = await postSupportMessage(
          ref,
          reply.trim(),
          token,
          requestId.current
        );

        setThread((current) =>
          current ? { ...current, messages: [...current.messages, message] } : current
        );
        setReply("");
        setSent(true);
        requestId.current = newRequestId();

        window.requestAnimationFrame(() => {
          endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        });
      } catch (caught) {
        setReplyError(supportErrorMessage(caught));
      } finally {
        setSending(false);
      }
    },
    [ref, reply, sending, token]
  );

  if (state === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (state === "missing") {
    return (
      <div className="mx-auto flex max-w-[560px] flex-col items-center py-6 text-center sm:py-12">
        <span className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface text-muted">
          <Link2Off className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="mt-4 font-display text-2xl font-bold">This link is not valid</h1>
        <p className="mt-2 max-w-[44ch] text-sm leading-relaxed text-muted">
          Private links expire after 30 days and only open the request they were
          issued for. If you have an older email from us, its link may still work.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href="/help">
            <Button size="md">Start a new request</Button>
          </Link>
          <Link href={isAuthenticated ? "/account/support" : "/login?next=/account/support"}>
            <Button size="md" variant="secondary">
              {isAuthenticated ? "Your requests" : "Sign in to see your requests"}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (state === "error" || !thread) {
    return (
      <Card className="p-6">
        <h1 className="font-display text-lg font-bold">Could not load this request</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {error ?? "Please try again."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setAttempt((value) => value + 1)}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Try again
          </Button>
          <Link href="/help">
            <Button size="sm" variant="secondary">
              Back to support
            </Button>
          </Link>
        </div>
      </Card>
    );
  }

  const status = SUPPORT_STATUS[thread.ticket.status];
  const topic = topicMeta(thread.ticket.topic);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/help"
          className="mb-3 inline-flex items-center gap-1 text-[0.7rem] text-muted transition-colors hover:text-fg"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          Support
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-2xl font-bold leading-tight">
            {thread.ticket.subject}
          </h1>
          <Badge tone={status.tone} size="sm">
            {status.label}
          </Badge>
        </div>

        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.7rem] text-muted">
          <span className="font-mono text-fg">{thread.ticket.ref}</span>
          <span aria-hidden="true">·</span>
          <span>{topic.label}</span>
          <span aria-hidden="true">·</span>
          <span>opened {formatTimestamp(thread.ticket.createdAt)}</span>
          {thread.ticket.resolvedAt && (
            <>
              <span aria-hidden="true">·</span>
              <span>resolved {formatTimestamp(thread.ticket.resolvedAt)}</span>
            </>
          )}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <CopyReference value={thread.ticket.ref} className="h-7 w-7" />
          <span className="flex items-center gap-1 text-[0.65rem] text-muted">
            <Lock className="h-3 w-3" aria-hidden="true" />
            Only this link opens this conversation
          </span>
        </div>
      </div>

      <div
        className={cn(
          "flex items-start gap-2 rounded-lg border px-3.5 py-2.5",
          STATUS_BOX[status.tone]
        )}
      >
        <span
          className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[status.tone])}
          aria-hidden="true"
        />
        <p className="text-xs leading-relaxed text-fg">{status.hint}</p>
      </div>

      <ul className="flex flex-col gap-3" aria-label="Conversation">
        {thread.messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}
      </ul>

      <div ref={endRef} />

      <p role="status" aria-live="polite" className="sr-only">
        {sent ? "Reply sent." : ""}
      </p>

      {thread.canReply ? (
        <Card className="p-4">
          <form onSubmit={sendReply} className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor="support-reply" className="text-xs font-medium text-muted">
                Add to this request
              </label>
              <span className="text-[0.65rem] tabular-nums text-muted">
                {reply.length}/4000
              </span>
            </div>

            <textarea
              id="support-reply"
              rows={4}
              maxLength={4000}
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              placeholder="Anything else we should know?"
              className="w-full resize-y rounded-lg border border-border bg-bg px-3.5 py-2.5 text-sm leading-relaxed text-fg placeholder:text-muted outline-none transition-[border-color,box-shadow] focus:border-ai focus:ring-2 focus:ring-ai/20"
              disabled={sending}
            />

            {replyError && (
              <p role="alert" className="text-xs text-no">
                {replyError}
              </p>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[0.68rem] text-muted">
                Added to the same conversation; we reply by email.
              </p>
              <Button
                type="submit"
                size="sm"
                loading={sending}
                disabled={reply.trim().length === 0}
                className="max-[430px]:w-full"
              >
                Send reply
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-muted">
              <Lock className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-fg">This request is closed</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Replying here is no longer possible. Start a new request and we will
                pick it up — you can mention {thread.ticket.ref} so we have the history.
              </p>
              <Link href="/help" className="mt-3 inline-block">
                <Button size="sm">Start a new request</Button>
              </Link>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

export default function SupportThreadPage() {
  return (
    <HelpShell>
      <Suspense
        fallback={
          <div className="flex flex-col gap-4">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        }
      >
        <ThreadContent />
      </Suspense>
    </HelpShell>
  );
}
