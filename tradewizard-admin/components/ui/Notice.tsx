import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";

type Tone = "info" | "success" | "warning" | "error";

const STYLES: Record<Tone, { box: string; icon: typeof Info }> = {
  info: { box: "border-border-strong/60 bg-surface", icon: Info },
  success: { box: "border-yes/30 bg-yes-soft", icon: CheckCircle2 },
  warning: { box: "border-warning/30 bg-warning-soft", icon: AlertTriangle },
  error: { box: "border-no/30 bg-no-soft", icon: OctagonAlert },
};

const ICON_TONE: Record<Tone, string> = {
  info: "text-muted",
  success: "text-yes",
  warning: "text-warning",
  error: "text-no",
};

/**
 * Inline notice. Errors state what failed and what to do next; they never
 * apologise and never reduce the message to "Something went wrong".
 */
export function Notice({
  tone = "info",
  title,
  children,
  action,
  className = "",
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const { box, icon: Icon } = STYLES[tone];

  return (
    <div className={["flex items-start gap-2.5 rounded-[8px] border px-3 py-2.5", box, className].join(" ")}>
      <Icon size={14} aria-hidden className={`mt-0.5 shrink-0 ${ICON_TONE[tone]}`} />

      <div className="min-w-0 flex-1">
        {title && <p className="text-[12.5px] font-medium text-fg">{title}</p>}
        {children && (
          <div className={["text-[11.5px] leading-relaxed text-muted", title ? "mt-0.5" : ""].join(" ")}>
            {children}
          </div>
        )}
      </div>

      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
