"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/utils/classNames";

/**
 * Public shell for the support pages.
 *
 * Deliberately not `AppShell`: a signed-out visitor asking for help should not be
 * shown the product navigation, and `/help` must work before authentication.
 */
export function HelpShell({
  children,
  size = "narrow",
}: {
  children: ReactNode;
  /** `wide` gives the two-column form page room; threads stay readable. */
  size?: "narrow" | "wide";
}) {
  const { isAuthenticated } = useAuth();

  const width = size === "wide" ? "max-w-[980px]" : "max-w-[760px]";

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip bg-bg text-fg">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-ai/[0.07] via-accent/[0.03] to-transparent"
      />

      <header className="relative border-b border-border/60">
        <div className={cn("mx-auto flex w-full items-center justify-between gap-4 px-4 py-4 sm:px-6", width)}>
          <Link
            href={isAuthenticated ? "/markets" : "/"}
            className="flex items-center gap-2.5 font-display text-lg font-bold"
          >
            <span className="h-2.5 w-2.5 rounded-full bg-ai shadow-[0_0_10px_var(--ai)]" />
            TradeWizard
            <span className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[0.62rem] font-medium uppercase tracking-wide text-muted">
              Support
            </span>
          </Link>

          <Link
            href={isAuthenticated ? "/markets" : "/login"}
            className="flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-fg"
          >
            {isAuthenticated ? (
              <>
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Back to app
              </>
            ) : (
              "Sign in"
            )}
          </Link>
        </div>
      </header>

      <main className={cn("relative mx-auto w-full flex-1 px-4 py-8 sm:px-6 sm:py-10", width)}>
        {children}
      </main>

      <footer className="relative border-t border-border/60">
        <div
          className={cn(
            "mx-auto flex w-full flex-col gap-2 px-4 py-5 text-[0.7rem] leading-relaxed text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6",
            width
          )}
        >
          <p>
            Replies come from{" "}
            <span className="text-fg">support@tradewizard.live</span>. That address
            does not receive email — use your private link instead.
          </p>

          <nav className="flex shrink-0 items-center gap-3" aria-label="Support links">
            <Link href="/help" className="transition-colors hover:text-fg">
              Contact support
            </Link>
            <Link
              href={isAuthenticated ? "/account/support" : "/login?next=/account/support"}
              className="transition-colors hover:text-fg"
            >
              Your requests
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
