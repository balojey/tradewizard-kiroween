"use client";

import { useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Dialog — one implementation for every confirmation and mutation form.
 *
 * Handles the things each hand-rolled overlay previously did differently:
 * Escape to close, scroll lock, initial focus, `aria-modal`, and a backdrop
 * that is inert while a request is in flight.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "sm",
  onSubmit,
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Renders the panel as a form; Enter submits. */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  dismissible?: boolean;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && dismissible) onClose();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    // Give the panel focus so Escape and Tab land inside it, not on the page.
    window.setTimeout(() => panelRef.current?.focus(), 0);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [dismissible, onClose, open]);

  if (!open || typeof document === "undefined") return null;

  const widths = {
    sm: "max-w-[420px]",
    md: "max-w-[560px]",
    lg: "max-w-[760px]",
  } as const;

  const body = (
    <>
      <header className="flex items-start justify-between gap-4 border-b border-border-soft px-4 py-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-[13px] font-medium text-fg">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{description}</p>
          )}
        </div>

        {dismissible && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-0.5 rounded-[6px] p-1 text-faint transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <X size={14} aria-hidden />
          </button>
        )}
      </header>

      {children && <div className="px-4 py-3.5">{children}</div>}

      {footer && (
        <footer className="flex items-center justify-end gap-2 border-t border-border-soft px-4 py-3">
          {footer}
        </footer>
      )}
    </>
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <div
        aria-hidden
        onClick={() => dismissible && onClose()}
        className="fixed inset-0 bg-[oklch(6%_0.01_260_/_0.72)]"
      />

      {onSubmit ? (
        <form
          ref={panelRef as unknown as React.RefObject<HTMLFormElement>}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          onSubmit={onSubmit}
          className={[
            "relative my-auto w-full rounded-[10px] border border-border-strong bg-surface shadow-[0_32px_64px_-24px_oklch(0%_0_0_/_0.9)] focus:outline-none",
            widths[size],
          ].join(" ")}
        >
          {body}
        </form>
      ) : (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={[
            "relative my-auto w-full rounded-[10px] border border-border-strong bg-surface shadow-[0_32px_64px_-24px_oklch(0%_0_0_/_0.9)] focus:outline-none",
            widths[size],
          ].join(" ")}
        >
          {body}
        </div>
      )}
    </div>,
    document.body
  );
}
