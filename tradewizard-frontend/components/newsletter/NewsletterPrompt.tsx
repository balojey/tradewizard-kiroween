"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/hooks/useAuth";
import {
  dismissNewsletterPrompt,
  getNewsletterState,
  setNewsletterOptIn,
} from "@/lib/newsletter-client";

/**
 * One-time consent prompt, shown after the first sign-in.
 *
 * The consent is affirmative — nothing is pre-selected, and closing the dialog
 * is *not* an opt-in. Both answers record that the question was asked, so it
 * never nags; an existing subscriber is never shown it at all.
 */
export function NewsletterPrompt() {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [dismissedThisSession, setDismissed] = useState(false);

  const { data } = useQuery({
    queryKey: ["newsletter", "state"],
    queryFn: getNewsletterState,
    enabled: isAuthenticated,
    retry: false,
    staleTime: 60_000,
  });

  // Small delay so the prompt does not compete with the page's first paint.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!data) return;
    const timer = setTimeout(() => setReady(true), 1_200);
    return () => clearTimeout(timer);
  }, [data]);

  const answer = useMutation({
    mutationFn: async (optIn: boolean) => {
      if (optIn) return setNewsletterOptIn(true, "signup_prompt");
      return dismissNewsletterPrompt();
    },
    onSettled: () => {
      setDismissed(true);
      void queryClient.invalidateQueries({ queryKey: ["newsletter", "state"] });
    },
  });

  const shouldShow =
    isAuthenticated &&
    ready &&
    !dismissedThisSession &&
    data?.available === true &&
    data.status === "none" &&
    !data.promptedAt;

  if (!shouldShow) return null;

  return (
    <Modal
      open
      onClose={() => setDismissed(true)}
      title="The Weekly Brief"
      size="sm"
      mobileSheet
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-muted">
          One email a week: the markets our agents moved on, what they got right, and
          what they got wrong. No noise, and you can leave with one click.
        </p>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            className="flex-1"
            loading={answer.isPending}
            onClick={() => answer.mutate(true)}
          >
            Yes, send it
          </Button>

          <Button
            variant="secondary"
            className="flex-1"
            disabled={answer.isPending}
            onClick={() => answer.mutate(false)}
          >
            No thanks
          </Button>
        </div>

        <p className="text-[0.68rem] leading-relaxed text-muted">
          We only send this after you say yes. Marketing email is separate from your
          analysis alerts, and unsubscribing never affects them.
        </p>
      </div>
    </Modal>
  );
}
