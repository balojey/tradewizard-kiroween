"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { HelpShell } from "@/components/support/HelpShell";
import { SupportForm } from "@/components/support/SupportForm";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAuth } from "@/hooks/useAuth";
import type { SupportTopic } from "@/lib/support-client";

const TOPICS: SupportTopic[] = ["analysis", "portfolio", "billing", "login", "data", "other"];

function readTopic(value: string | null): SupportTopic {
  return TOPICS.includes(value as SupportTopic) ? (value as SupportTopic) : "other";
}

/** Only same-app paths become context: a crafted `from=https://…` is ignored. */
function readFrom(value: string | null): string | undefined {
  return value && value.startsWith("/") ? value : undefined;
}

const STEPS = [
  {
    title: "We read it with the context attached",
    body: "If you came from an analysis or a session, its identifiers travel with your message — no screenshots or timestamps to collect.",
  },
  {
    title: "We reply by email",
    body: "The reply goes to the address on the request. Each request keeps one private conversation link.",
  },
  {
    title: "You answer in the same place",
    body: "Open the link to read the reply, add detail, or tell us it is fixed. You will not be asked to start over.",
  },
];

function HowItWorks({ signedIn }: { signedIn: boolean }) {
  return (
    <>
      <ol className="flex flex-col gap-5">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-[0.7rem] font-semibold text-fg">
              {index + 1}
            </span>
            <div>
              <p className="text-sm font-medium text-fg">{step.title}</p>
              <p className="mt-1 max-w-[48ch] text-xs leading-relaxed text-muted">
                {step.body}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-6 border-t border-border/60 pt-4 text-[0.7rem] leading-relaxed text-muted">
        {signedIn
          ? "You are signed in, so we will attach this request to your account and use your verified email."
          : "No account needed. We ask for an email only so we can reply — it is never shown publicly or used to sign you up."}
      </p>
    </>
  );
}

function HelpPageContent() {
  const params = useSearchParams();
  const { user } = useAuth();

  const from = readFrom(params.get("from"));
  const topic = readTopic(params.get("topic"));
  const signedIn = Boolean(user);

  return (
    <HelpShell size="wide">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] lg:items-start lg:gap-12">
        <div className="lg:sticky lg:top-10">
          <p className="text-[0.68rem] font-medium uppercase tracking-[0.12em] text-ai">
            Support
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold leading-[1.15] tracking-tight sm:text-[2.1rem]">
            Tell us what went wrong.
          </h1>
          <p className="mt-3 max-w-[46ch] text-sm leading-relaxed text-muted">
            Something in an analysis, a Portfolio Manager session or your account is
            not behaving. Describe it once here and we will take it from there.
          </p>

          {/* Desktop keeps the explanation beside the form; mobile folds it below. */}
          <div className="mt-8 hidden lg:block">
            <HowItWorks signedIn={signedIn} />
          </div>
        </div>

        <div>
          <Card className="p-5 sm:p-6">
            <div className="mb-5 border-b border-border/60 pb-4">
              <h2 className="font-display text-lg font-bold">New request</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                The more specific the subject, the faster we can route it.
              </p>
            </div>

            <SupportForm
              lockedEmail={user?.email}
              defaultTopic={topic}
              context={from ? { page: from } : undefined}
              contextSummary={from ? [{ label: "Page", value: from }] : undefined}
            />
          </Card>

          <details className="group mt-4 rounded-xl border border-border bg-surface px-4 py-3 lg:hidden">
            <summary className="cursor-pointer list-none text-xs font-medium text-fg marker:hidden">
              <span className="flex items-center justify-between gap-2">
                How this works
                <span
                  aria-hidden="true"
                  className="text-muted transition-transform group-open:rotate-180"
                >
                  ▾
                </span>
              </span>
            </summary>
            <div className="mt-4">
              <HowItWorks signedIn={signedIn} />
            </div>
          </details>
        </div>
      </div>

      <p className="mt-8 text-[0.72rem] leading-relaxed text-muted">
        Already have a request? Open the link in the email we sent — it is the only
        way back into that conversation. Signed in?{" "}
        <Link href="/account/support" className="text-accent transition-colors hover:text-fg">
          See your requests
        </Link>
        .
      </p>
    </HelpShell>
  );
}

export default function HelpPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-[980px] px-4 py-16">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="mt-6 h-72 w-full" />
        </div>
      }
    >
      <HelpPageContent />
    </Suspense>
  );
}
