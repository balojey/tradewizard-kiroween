"use client";

import { useState } from "react";
import { LifeBuoy } from "lucide-react";
import { SupportDialog } from "./SupportDialog";
import { cn } from "@/utils/classNames";

export interface AnalysisSupportButtonProps {
  marketSlug?: string;
  /** Pipeline market id (conditionId when available). */
  marketId?: string;
  analysisId?: string;
  recommendation?: string | null;
  marketQuestion?: string;
  plan?: string;
  label?: string;
  variant?: "inline" | "icon";
  className?: string;
}

function recommendationLabel(value: string | null | undefined): string | null {
  if (value === "LONG_YES") return "Buy YES";
  if (value === "LONG_NO") return "Buy NO";
  if (value === "NO_TRADE") return "No trade";
  return null;
}

/**
 * Support entry attached to one specific analysis.
 *
 * Used wherever a verdict is shown: the AI panel, each entry in the track record,
 * and any future analysis list. The analysis id is the whole point — it lets
 * support fetch the exact run the customer is complaining about instead of asking
 * for a link and a timestamp.
 */
export function AnalysisSupportButton({
  marketSlug,
  marketId,
  analysisId,
  recommendation,
  marketQuestion,
  plan,
  label = "Something wrong with this analysis? Tell us",
  variant = "inline",
  className,
}: AnalysisSupportButtonProps) {
  const [open, setOpen] = useState(false);

  const context: Record<string, string> = {};
  if (marketSlug) context.page = `/markets/${marketSlug}`;
  if (marketId) context.marketId = marketId;
  if (marketSlug) context.marketSlug = marketSlug;
  if (analysisId) context.analysisId = analysisId;
  if (recommendation) context.recommendation = recommendation;
  if (plan) context.plan = plan;

  const summary: Array<{ label: string; value: string }> = [];
  if (marketQuestion) {
    summary.push({
      label: "Market",
      value:
        marketQuestion.length > 60
          ? `${marketQuestion.slice(0, 57)}…`
          : marketQuestion,
    });
  }
  const rec = recommendationLabel(recommendation);
  if (rec) summary.push({ label: "Analysis", value: rec });
  if (analysisId) summary.push({ label: "Run", value: analysisId.slice(0, 8) });
  if (plan) summary.push({ label: "Plan", value: plan });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        aria-haspopup="dialog"
        title={label}
        className={cn(
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
          variant === "icon"
            ? "flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg"
            : "inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs text-muted transition-colors hover:text-accent",
          className
        )}
      >
        <LifeBuoy
          className={variant === "icon" ? "h-3.5 w-3.5" : "h-3.5 w-3.5"}
          aria-hidden="true"
        />
        {variant === "inline" && label}
      </button>

      <SupportDialog
        open={open}
        onClose={() => setOpen(false)}
        defaultTopic="analysis"
        context={context}
        contextSummary={summary}
      />
    </>
  );
}
