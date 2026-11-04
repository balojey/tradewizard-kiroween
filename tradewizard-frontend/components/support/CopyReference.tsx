"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/utils/classNames";

/** Small copy control for support references (TW-XXXXXX). */
export function CopyReference({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
      aria-label={`Copy reference ${value}`}
      title="Copy reference"
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted transition-colors",
        "hover:border-border-strong hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className
      )}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-yes" aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      )}
    </button>
  );
}
