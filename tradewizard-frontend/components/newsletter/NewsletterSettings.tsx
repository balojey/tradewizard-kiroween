"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { Toggle } from "@/components/ui/Toggle";
import {
  getNewsletterState,
  setNewsletterOptIn,
  type NewsletterState,
} from "@/lib/newsletter-client";

/**
 * The durable marketing-consent control.
 *
 * Separate from the alert preferences above it on purpose: someone may want
 * analysis results by email and no marketing, or the reverse. Turning it off is
 * an unsubscribe, not a pause — it is recorded with a source so the decision is
 * auditable.
 */
export function NewsletterSettings() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<NewsletterState>({
    queryKey: ["newsletter", "state"],
    queryFn: getNewsletterState,
    retry: false,
  });

  const update = useMutation({
    mutationFn: (optIn: boolean) => setNewsletterOptIn(optIn, "account_toggle"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["newsletter", "state"] }),
  });

  const subscribed = data?.status === "subscribed";

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <Mail className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-fg">The Weekly Brief</h2>
          <p className="text-[0.6rem] text-muted">Marketing email — separate from alerts</p>
        </div>
      </div>

      <div className="p-4">
        {isLoading ? (
          <div className="h-10 animate-pulse rounded bg-surface-2" aria-hidden="true" />
        ) : isError || !data ? (
          <p className="text-[0.7rem] text-muted">
            Could not load your newsletter preference. Refresh to try again.
          </p>
        ) : (
          <>
            <Toggle
              layout="end"
              checked={subscribed}
              onChange={(next) => update.mutate(next)}
              disabled={update.isPending || !data.available}
              label="Send me The Weekly Brief"
              description="One email a week: what the agents moved on, and how it turned out."
            />

            {!data.available && (
              <p className="mt-2 text-[0.65rem] text-muted">
                The newsletter is paused right now. Your preference is saved and will
                apply when it returns.
              </p>
            )}

            {subscribed && (
              <p className="mt-2 text-[0.65rem] text-muted">
                You can leave at any time — every issue has a one-click unsubscribe
                link, and it never affects your analysis alerts.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
