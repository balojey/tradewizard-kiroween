"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { checkUnsubscribeToken, unsubscribeFromNewsletter } from "@/lib/newsletter-client";

type State = "checking" | "valid" | "invalid" | "working" | "done" | "error";

function UnsubscribeContent() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [state, setState] = useState<State>(() => (token ? "checking" : "invalid"));
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!token) return;

    checkUnsubscribeToken(token)
      .then((valid) => {
        if (!cancelled) setState(valid ? "valid" : "invalid");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setMessage(error instanceof Error ? error.message : null);
        setState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function unsubscribe() {
    setState("working");
    setMessage(null);

    try {
      await unsubscribeFromNewsletter(token);
      setState("done");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : null);
      setState("error");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10 text-fg">
      <div className="w-full max-w-[440px]">
        <Link
          href="/"
          className="mb-6 flex items-center justify-center gap-2 font-display text-xl font-bold"
        >
          <span className="h-2 w-2 rounded-full bg-ai shadow-[0_0_8px_var(--ai)]" />
          TradeWizard
        </Link>

        <div className="rounded-[16px] border border-border bg-surface p-6 sm:p-7">
          <h1 className="font-display text-lg font-bold">The Weekly Brief</h1>

          {state === "checking" && (
            <p className="mt-2 text-sm text-muted">Checking this link…</p>
          )}

          {state === "valid" && (
            <>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Unsubscribe from the newsletter? You will still receive analysis
                results and account email — this only stops marketing email.
              </p>
              <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                <Button className="flex-1" onClick={unsubscribe}>
                  Unsubscribe
                </Button>
                <Link href="/account" className="flex-1">
                  <Button variant="secondary" className="w-full">
                    Keep receiving
                  </Button>
                </Link>
              </div>
            </>
          )}

          {state === "working" && (
            <p className="mt-2 text-sm text-muted">Unsubscribing…</p>
          )}

          {state === "done" && (
            <>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                You are unsubscribed and will not receive another issue. Your analysis
                alerts are untouched.
              </p>
              <Link href="/account" className="mt-5 inline-block">
                <Button variant="secondary">Change your mind</Button>
              </Link>
            </>
          )}

          {(state === "invalid" || state === "error") && (
            <>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {state === "invalid"
                  ? "This unsubscribe link is not valid. It may have been cut off by your email client."
                  : (message ?? "Something went wrong. Please try again.")}
              </p>
              <p className="mt-3 text-xs leading-relaxed text-muted">
                You can also manage it from{" "}
                <Link href="/account" className="text-accent hover:text-fg">
                  your account
                </Link>
                .
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-bg">
          <p className="text-sm text-muted">Loading…</p>
        </div>
      }
    >
      <UnsubscribeContent />
    </Suspense>
  );
}
