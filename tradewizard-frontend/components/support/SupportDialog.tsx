"use client";

import { Modal } from "@/components/ui/Modal";
import { SupportForm, type SupportContextChip } from "./SupportForm";
import type { SupportTopic } from "@/lib/support-client";
import { useAuth } from "@/hooks/useAuth";

export interface SupportDialogProps {
  open: boolean;
  onClose: () => void;
  defaultTopic?: SupportTopic;
  context?: Record<string, string>;
  contextSummary?: SupportContextChip[];
}

/**
 * Contextual support dialog.
 *
 * The form is mounted only while open, so closing and reopening starts clean —
 * including a new idempotency key, which is what we want: the previous ticket
 * already exists.
 */
export function SupportDialog({
  open,
  onClose,
  defaultTopic,
  context,
  contextSummary,
}: SupportDialogProps) {
  const { user } = useAuth();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Contact support"
      size="lg"
      mobileSheet
    >
      <div className="max-h-[72vh] overflow-y-auto overscroll-contain pr-0.5">
        <p className="mb-4 text-xs leading-relaxed text-muted">
          Tell us what went wrong. We reply by email, and every request keeps one
          private conversation link.
        </p>

        {open && (
          <SupportForm
            lockedEmail={user?.email}
            defaultTopic={defaultTopic}
            context={context}
            contextSummary={contextSummary}
          />
        )}
      </div>
    </Modal>
  );
}
