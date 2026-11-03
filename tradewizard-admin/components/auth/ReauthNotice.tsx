"use client";

import { AdminApiError } from "@/lib/admin-api";
import { useAdminAuth } from "@/providers/AdminAuthProvider";

/**
 * Fresh sign-in prompts.
 *
 * Destructive actions (kill switch, membership, settings) require an `auth_time`
 * within ten minutes — a valid hour-old token is not proof that a person is at
 * the keyboard. Cognito refresh tokens do **not** reset `auth_time`, so the only
 * way to satisfy it is a real re-login; this component is that escape hatch,
 * because otherwise the API's message is a dead end.
 */
/** Message for inline display, or undefined when there is nothing to say. */
export function errorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

export function isReauthRequired(error: unknown): boolean {
  return error instanceof AdminApiError && error.code === "REAUTH_REQUIRED";
}

export function ReauthNotice({ error }: { error: unknown }) {
  const { signOut } = useAdminAuth();

  if (!isReauthRequired(error)) return null;

  const next = typeof window !== "undefined" ? window.location.pathname : "/";

  return (
    <div className="rounded-[8px] border border-warning/40 bg-warning/10 p-3 text-[11.5px] leading-relaxed text-fg">
      <p>For safety, this action needs a sign-in from the last ten minutes.</p>
      <button
        type="button"
        onClick={() => {
          signOut();
          window.location.href = `/login?next=${encodeURIComponent(next)}`;
        }}
        className="mt-2 h-7 rounded-[6px] bg-accent px-2.5 text-[11px] font-medium text-white transition-[filter] hover:brightness-110"
      >
        Sign in again
      </button>
    </div>
  );
}
