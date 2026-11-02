"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAdminAuth } from "@/providers/AdminAuthProvider";

/** Only allow same-origin relative paths, so `?next=` can't become an open redirect. */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/overview";
  return value;
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { status, mfaPending, error, signIn, submitMfa, cancelMfa, clearError } = useAdminAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const next = safeNext(params.get("next"));

  useEffect(() => {
    if (status === "authenticated") {
      router.replace(next);
    }
  }, [next, router, status]);

  async function onSubmitCredentials(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      // The provider switches to the MFA step, or flips to authenticated and
      // the effect above redirects.
      setPassword("");
    } catch {
      // Message already surfaced by the provider.
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await submitMfa(code.trim());
    } catch {
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  if (mfaPending) {
    return (
      <form onSubmit={onSubmitCode} className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold text-fg">Two-factor code</h2>
          <p className="mt-1 text-xs text-muted">
            Enter the 6-digit code from your authenticator for{" "}
            <span className="mono text-fg">{email}</span>.
          </p>
        </div>

        <Input
          label="Authentication code"
          value={code}
          onChange={(event) => {
            clearError();
            setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          mono
          maxLength={6}
          placeholder="000000"
          error={error ?? undefined}
        />

        <Button type="submit" loading={busy} disabled={code.length !== 6}>
          Verify and continue
        </Button>

        <button
          type="button"
          onClick={() => {
            cancelMfa();
            setCode("");
          }}
          className="text-xs text-muted hover:text-fg"
        >
          Use a different account
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmitCredentials} className="flex flex-col gap-4">
      <Input
        label="Email"
        type="email"
        value={email}
        onChange={(event) => {
          clearError();
          setEmail(event.target.value);
        }}
        autoComplete="username"
        autoFocus
        required
      />

      <Input
        label="Password"
        type="password"
        value={password}
        onChange={(event) => {
          clearError();
          setPassword(event.target.value);
        }}
        autoComplete="current-password"
        error={error ?? undefined}
        required
      />

      <Button type="submit" loading={busy}>
        Continue
      </Button>
    </form>
  );
}
