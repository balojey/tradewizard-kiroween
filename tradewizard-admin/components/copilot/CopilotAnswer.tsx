"use client";

import { Bot, ShieldCheck, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { CitationList } from "@/components/copilot/CitationList";
import { SuggestedActions } from "@/components/copilot/SuggestedActions";
import { formatRelative } from "@/lib/format";
import type { CopilotAnswer as CopilotAnswerData } from "@/types/admin";

const CONFIDENCE_TONE = {
  high: "yes",
  medium: "warning",
  low: "no",
} as const;

/**
 * One answer. Plain text, explicit confidence, citations, and links only.
 *
 * The permanent "Read-only summary" line is not decoration: it is the one
 * sentence that keeps an operator from treating a summary as an authority, and
 * it is present on every rendering, including drafts.
 */
export function CopilotAnswer({
  response,
  onUseAnswer,
  useAnswerLabel = "Use as reply draft",
  compact = false,
  draft = false,
}: {
  response: CopilotAnswerData;
  onUseAnswer?: (answer: string) => void;
  useAnswerLabel?: string;
  compact?: boolean;
  draft?: boolean;
}) {
  const tokens = response.usage.inputTokens + response.usage.outputTokens;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="ai">
          <Sparkles size={10} aria-hidden /> Warden
        </Badge>
        <Badge tone={CONFIDENCE_TONE[response.confidence]}>{response.confidence} confidence</Badge>

        <span className="text-[10.5px] text-faint">
          {formatRelative(response.generatedAt)} · {response.citations.length} source
          {response.citations.length === 1 ? "" : "s"} · ~{tokens} tokens
        </span>
      </div>

      <p
        className={[
          "whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-fg",
          compact ? "max-h-[220px] overflow-y-auto" : "",
        ].join(" ")}
      >
        {response.answer}
      </p>

      <CitationList citations={response.citations} />
      <SuggestedActions actions={response.suggestedActions} />

      {response.limitations && (
        <Notice tone="warning" title="Limits of this answer">
          {response.limitations}
        </Notice>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-soft pt-2">
        <span className="flex items-center gap-1 text-[10.5px] text-faint">
          <ShieldCheck size={11} aria-hidden className="text-yes" />
          {draft ? "Model draft. Verify before sending." : "Read-only summary. Verify before acting."}
        </span>

        <span className="flex items-center gap-2">
          {onUseAnswer && (
            <Button
              size="sm"
              type="button"
              variant="secondary"
              onClick={() => onUseAnswer(response.answer)}
            >
              <Bot size={12} aria-hidden />
              {useAnswerLabel}
            </Button>
          )}
          <span className="mono text-[10px] text-faint">{response.model}</span>
        </span>
      </div>
    </div>
  );
}
