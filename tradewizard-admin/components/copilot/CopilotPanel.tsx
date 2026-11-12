"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Notice } from "@/components/ui/Notice";
import { CopilotAnswer } from "@/components/copilot/CopilotAnswer";
import { useCopilot, useCopilotStatus } from "@/hooks/useCopilot";
import type { CopilotAnswer as CopilotAnswerData, CopilotKind } from "@/types/admin";

export interface CopilotPrompt {
  label: string;
  question?: string;
  mode?: "summary" | "draft_reply";
  /** Override the retrieval window for this prompt (incident questions). */
  windowHours?: number;
}

export interface CopilotPanelProps {
  kind: CopilotKind;
  /** Surface-specific body fields, forwarded to the typed route. */
  context: Record<string, unknown>;
  title?: string;
  description?: string;
  prompts?: CopilotPrompt[];
  placeholder?: string;
  /** Risk brief and support do not ask a free-text question. */
  questionEnabled?: boolean;
  compact?: boolean;
  onUseAnswer?: (answer: string) => void;
  useAnswerLabel?: string;
}

function buildBody(
  kind: CopilotKind,
  context: Record<string, unknown>,
  question: string,
  mode: "summary" | "draft_reply"
): Record<string, unknown> {
  switch (kind) {
    case "support":
      return { ticketId: context.ticketId, mode };
    case "risk_brief":
      return {
        action: context.action,
        targetType: context.targetType,
        targetId: context.targetId,
        userId: context.userId,
        sessionId: context.sessionId,
        payload: context.payload,
      };
    case "analysis":
      return { analysisId: context.analysisId, question: question || undefined };
    case "session":
      return { sessionId: context.sessionId, question: question || undefined };
    case "incident":
    default:
      return {
        question: question || undefined,
        from: context.from,
        to: context.to,
        targetType: context.targetType,
        targetId: context.targetId,
      };
  }
}

/**
 * Ask Warden.
 *
 * Nothing renders until the capability probe says the copilot is enabled, so
 * flipping `copilot_enabled` really does remove the feature from the portal.
 * Answers are never optimistic: the panel shows a loading line, then exactly
 * what the server returned.
 */
export function CopilotPanel({
  kind,
  context,
  title = "Ask Warden",
  description = "Read-only summary of the records behind this view. It cannot change anything.",
  prompts = [],
  placeholder = "Ask a question about these records",
  questionEnabled = true,
  compact = false,
  onUseAnswer,
  useAnswerLabel,
}: CopilotPanelProps) {
  const { data: status } = useCopilotStatus();
  const mutation = useCopilot();

  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<"summary" | "draft_reply">("summary");
  const [lastMode, setLastMode] = useState<"summary" | "draft_reply" | null>(null);

  if (!status?.enabled) return null;

  function ask(prompt?: CopilotPrompt) {
    const nextQuestion = prompt?.question ?? question;
    const nextMode = prompt?.mode ?? mode;

    if (prompt?.question !== undefined) setQuestion(prompt.question);
    if (prompt?.mode) setMode(prompt.mode);
    setLastMode(prompt?.mode ?? (kind === "support" ? mode : null));

    const now = new Date();
    const nextContext =
      prompt?.windowHours !== undefined
        ? {
            ...context,
            from: new Date(now.getTime() - prompt.windowHours * 3_600_000).toISOString(),
            to: now.toISOString(),
          }
        : context;

    mutation.mutate({
      kind,
      body: buildBody(kind, nextContext, nextQuestion, nextMode),
    });
  }

  const answer = mutation.data as CopilotAnswerData | undefined;
  const error = mutation.error as (Error & { code?: string }) | null;

  return (
    <Panel
      title={title}
      description={description}
      actions={
        <Badge tone="ai">
          <Sparkles size={10} aria-hidden /> read-only
        </Badge>
      }
      className={compact ? "bg-surface-2/40" : undefined}
    >
      <div className="flex flex-col gap-3">
        {(questionEnabled || prompts.length > 0) && (
          <div className="flex flex-wrap items-end gap-2">
            {questionEnabled && (
              <div className="min-w-[240px] flex-1">
                <Input
                  label=""
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder={placeholder}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      ask();
                    }
                  }}
                  disabled={mutation.isPending}
                />
              </div>
            )}

            {questionEnabled && (
              <Button
                size="sm"
                type="button"
                loading={mutation.isPending}
                disabled={question.trim().length < 3}
                onClick={() => ask()}
              >
                Ask
              </Button>
            )}

            {prompts.map((prompt) => (
              <Button
                key={prompt.label}
                size="sm"
                type="button"
                variant="secondary"
                loading={mutation.isPending && (mutation.variables?.body?.mode as string | undefined) === prompt.mode}
                onClick={() => ask(prompt)}
                disabled={mutation.isPending}
              >
                {prompt.label}
              </Button>
            ))}
          </div>
        )}

        {mutation.isPending && (
          <p role="status" className="text-[11.5px] text-muted">
            Reading the records and writing a summary…
          </p>
        )}

        {error && !mutation.isPending && (
          <Notice tone="error" title="The copilot could not answer">
            {error.code === "RATE_LIMITED"
              ? error.message
              : error.code === "COPILOT_DISABLED"
                ? "The copilot was switched off. An owner can re-enable it in Runtime settings."
                : error.message}
          </Notice>
        )}

        {answer && !mutation.isPending && (
          <CopilotAnswer
            response={answer}
            onUseAnswer={lastMode === "draft_reply" ? onUseAnswer : undefined}
            useAnswerLabel={useAnswerLabel}
            compact={compact}
            draft={lastMode === "draft_reply"}
          />
        )}

        {!answer && !mutation.isPending && !error && (
          <p className="text-[11.5px] text-faint">
            Warden reads audit rows, tickets, analyses, and session records you can already open.
            It never acts.
          </p>
        )}
      </div>
    </Panel>
  );
}
