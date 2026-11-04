"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

/**
 * Public web view of an issue.
 *
 * The email HTML is rendered by the API (the same renderer that sent it) and
 * embedded in a sandboxed iframe: no scripts, no access to the app's origin.
 */
function WebViewContent() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`${API_BASE}/newsletter/web/${encodeURIComponent(slug)}`)
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) {
          setError(
            response.status === 404
              ? "This issue is not available. It may still be a draft."
              : "Could not load this issue."
          );
          return;
        }
        setHtml(await response.text());
      })
      .catch(() => {
        if (!cancelled) setError("Could not reach TradeWizard. Check your connection.");
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="border-b border-border/60">
        <div className="mx-auto flex w-full max-w-[720px] items-center justify-between px-4 py-3.5 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-display text-base font-bold">
            <span className="h-2 w-2 rounded-full bg-ai shadow-[0_0_8px_var(--ai)]" />
            TradeWizard
          </Link>
          <Link href="/account" className="text-xs text-muted transition-colors hover:text-fg">
            Email preferences
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[680px] px-4 py-6">
        {error ? (
          <div className="rounded-xl border border-border bg-surface p-6">
            <p className="text-sm text-fg">{error}</p>
            <Link
              href="/account"
              className="mt-3 inline-block text-xs text-accent hover:text-fg"
            >
              Manage your email preferences
            </Link>
          </div>
        ) : html ? (
          <iframe
            title="Newsletter issue"
            srcDoc={html}
            sandbox=""
            className="h-[calc(100vh-9rem)] w-full rounded-xl border border-border bg-white"
          />
        ) : (
          <div className="h-64 animate-pulse rounded-xl bg-surface-2" aria-hidden="true" />
        )}
      </main>
    </div>
  );
}

export default function NewsletterWebView() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-bg text-sm text-muted">
          Loading…
        </div>
      }
    >
      <WebViewContent />
    </Suspense>
  );
}
