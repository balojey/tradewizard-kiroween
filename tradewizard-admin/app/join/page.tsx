"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Notice } from "@/components/ui/Notice";
import { adminFetch, apiBaseUrl } from "@/lib/admin-api";
import { previewAdminEmail } from "@/lib/admin-email";
import { ROLE_DESCRIPTION, ROLE_LABEL } from "@/constants/roles";
import type { AdminMember } from "@/types/admin";

/**
 * Public landing page for an invite link (`/join#t=<token>`).
 *
 * The token is in the URL *fragment* on purpose: fragments are never sent to a
 * server, so it cannot appear in API Gateway access logs, CloudWatch, or a
 * `Referer` header. The page reads it once, clears it from the address bar, and
 * sends it only in POST bodies.
 *
 * The address preview is a mirror of `infra/services/shared/admin-email.ts`. The
 * server is authoritative; this only exists so nobody submits an address and is
 * surprised afterwards about which mailbox the invitation reaches.
 */

type InviteStatus = "active" | "expired" | "revoked" | "exhausted";

interface InviteInfo {
  status: InviteStatus;
  role: AdminMember["role"];
  expiresAt: string;
  remainingUses: number;
}

type Phase =
  | { kind: "reading" }
  | { kind: "missing" }
  | { kind: "loading" }
  | { kind: "unavailable"; info: InviteInfo }
  | { kind: "invalid"; message: string }
  | { kind: "ready"; info: InviteInfo }
  | { kind: "submitting"; info: InviteInfo }
  | { kind: "done"; adminEmail: string; role: AdminMember["role"] };

const INACTIVE_COPY: Record<Exclude<InviteStatus, "active">, string> = {
  revoked: "This invitation link was revoked. Ask the owner who sent it for a new one.",
  expired: "This invitation link has expired. Ask the owner who sent it for a new one.",
  exhausted: "This invitation link has been used the maximum number of times. Ask the owner for a new one.",
};

export default function JoinPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "reading" });
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const lookup = useCallback(async (value: string) => {
    try {
      const info = await adminFetch<InviteInfo>("join/lookup", {
        method: "POST",
        body: { token: value },
      });

      setPhase(info.status === "active" ? { kind: "ready", info } : { kind: "unavailable", info });
    } catch (caught) {
      setPhase({
        kind: "invalid",
        message: (caught as Error).message || "That link is not valid.",
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    // The token lives in the fragment, which only exists in the browser. Read it
    // once here, then clear it so it is not left in the address bar or history.
    const start = async () => {
      if (!apiBaseUrl()) {
        if (!cancelled) {
          setPhase({
            kind: "invalid",
            message: "This portal is not configured. Ask the owner to check the deployment.",
          });
        }
        return;
      }

      const hash = window.location.hash.replace(/^#/, "");
      const value = new URLSearchParams(hash).get("t")?.trim() ?? "";

      if (value) window.history.replaceState(null, "", window.location.pathname);

      if (!value) {
        if (!cancelled) setPhase({ kind: "missing" });
        return;
      }

      setToken(value);
      setPhase({ kind: "loading" });
      await lookup(value);
    };

    void start();

    return () => {
      cancelled = true;
    };
  }, [lookup]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (phase.kind !== "ready") return;

    setError(null);
    setPhase({ kind: "submitting", info: phase.info });

    try {
      const result = await adminFetch<{ adminEmail: string; role: AdminMember["role"] }>(
        "join/register",
        { method: "POST", body: { token, email: email.trim(), fullName: fullName.trim() || undefined } }
      );

      window.localStorage.setItem("tw_admin_hint_email", result.adminEmail);
      setPhase({ kind: "done", adminEmail: result.adminEmail, role: result.role });
    } catch (caught) {
      setError((caught as Error).message || "Registration failed. Try again.");
      setPhase({ kind: "ready", info: phase.info });
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[520px]">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="text-[14px] font-medium text-fg">TradeWizard Warden</span>
          <span className="rounded-[4px] border border-border-strong/60 px-1.5 py-px text-[10px] text-muted">
            invitation
          </span>
        </div>

        <Panel>
          {phase.kind === "reading" && (
            <p className="text-[12px] text-muted">Reading your invitation…</p>
          )}

          {phase.kind === "missing" && (
            <Notice tone="warning" title="This page needs an invitation link">
              Open the link exactly as it was sent to you. If it looks truncated, ask the owner to
              send it again.
            </Notice>
          )}

          {phase.kind === "loading" && (
            <p className="text-[12px] text-muted">Checking the link…</p>
          )}

          {phase.kind === "invalid" && (
            <Notice tone="error" title="That invitation link is not valid">
              {phase.message}
            </Notice>
          )}

          {phase.kind === "unavailable" && (
            <div className="flex flex-col gap-3">
              <Notice tone="warning" title="This link cannot be used">
                {INACTIVE_COPY[phase.info.status as Exclude<InviteStatus, "active">]}
              </Notice>
              <p className="text-[11.5px] leading-relaxed text-muted">
                It was for a <strong className="text-fg">{ROLE_LABEL[phase.info.role]}</strong>{" "}
                account. Nothing was created.
              </p>
            </div>
          )}

          {(phase.kind === "ready" || phase.kind === "submitting") && (
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <div>
                <h1 className="text-[15px] font-medium text-fg">
                  Join Warden as {ROLE_LABEL[phase.info.role]}
                </h1>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
                  {ROLE_DESCRIPTION[phase.info.role]}
                </p>
              </div>

              <Input
                label="Your email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                hint="Use an address you can read right now — the invitation goes to its +warden alias."
                autoComplete="email"
                autoFocus
                required
              />

              {email.includes("@") && (
                <div className="rounded-[8px] border border-border-strong/50 bg-surface-2 p-3">
                  <p className="text-[10.5px] uppercase tracking-wide text-faint">
                    You will sign in as
                  </p>
                  <p className="mono mt-1 break-all text-[12px] text-fg">
                    {previewAdminEmail(email)}
                  </p>
                  <p className="mt-1.5 text-[10.5px] leading-relaxed text-faint">
                    This is a dedicated Warden identity. It reaches the same inbox on Gmail,
                    Outlook and most providers, and your TradeWizard product account is never
                    touched.
                  </p>
                </div>
              )}

              <Input
                label="Full name (optional)"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Ada Lovelace"
                autoComplete="name"
              />

              {error && (
                <Notice tone="error" title="Could not create the account">
                  {error}
                </Notice>
              )}

              <Button
                type="submit"
                loading={phase.kind === "submitting"}
                disabled={!email.includes("@")}
              >
                Create my account
              </Button>

              <p className="text-[10.5px] leading-relaxed text-faint">
                Next: we email a one-time password to the address above. You choose your own
                password at first sign-in, then add an authenticator app.
              </p>
            </form>
          )}

          {phase.kind === "done" && (
            <div className="flex flex-col gap-4">
              <div>
                <h1 className="text-[15px] font-medium text-fg">Account created</h1>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
                  Your invitation was emailed to the address below. It includes a one-time
                  password; you will replace it at first sign-in.
                </p>
              </div>

              <div className="rounded-[8px] border border-border-strong/60 bg-surface-2 p-3">
                <p className="text-[10.5px] uppercase tracking-wide text-faint">Sign in as</p>
                <p className="mono mt-1 break-all text-[12.5px] text-fg">{phase.adminEmail}</p>
                <p className="mt-1 text-[10.5px] text-faint">
                  {ROLE_LABEL[phase.role]} access · check the spam folder if it is not there in a
                  few minutes
                </p>
              </div>

              <Button
                type="button"
                onClick={() =>
                  router.push(`/login?email=${encodeURIComponent(phase.adminEmail)}`)
                }
              >
                Go to sign in
              </Button>
            </div>
          )}
        </Panel>

        <p className="mt-4 text-center text-[10.5px] text-faint">
          Internal operations portal. Access is limited and every action is audited.
        </p>
      </div>
    </main>
  );
}
