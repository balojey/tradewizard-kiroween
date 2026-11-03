"use client";

/**
 * Admin authentication state.
 *
 * Holds the token set in memory (mirrored to sessionStorage), refreshes it five
 * minutes before expiry, and exposes the two-step sign-in (password → TOTP).
 *
 * Refresh scheduling lives in an effect keyed on the token set: when a refreshed
 * token is stored, the effect re-runs and schedules the next refresh. That keeps
 * the cycle declarative — no self-recursive callbacks, no manual timer juggling.
 *
 * The MFA challenge session is kept in memory only: it is a short-lived token
 * from Cognito and must not outlive the tab.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  completeMfa as completeMfaRequest,
  completeNewPassword as completeNewPasswordRequest,
  describeAuthError,
  refreshSession,
  signIn as signInRequest,
} from "@/lib/cognito";
import {
  clearSession,
  isExpired,
  loadSession,
  saveSession,
  type AdminTokens,
} from "@/lib/session";

type AuthStatus = "loading" | "anonymous" | "authenticated";

interface AdminAuthValue {
  status: AuthStatus;
  tokens: AdminTokens | null;
  idToken: string | null;
  /** Set while the user must supply a TOTP code. */
  mfaPending: boolean;
  /** Set while an invited account must choose its own password. */
  newPasswordPending: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  submitNewPassword: (password: string) => Promise<void>;
  submitMfa: (code: string) => Promise<void>;
  cancelMfa: () => void;
  signOut: () => void;
  clearError: () => void;
}

const AdminAuthContext = createContext<AdminAuthValue | null>(null);

const REFRESH_LEAD_MS = 5 * 60 * 1000;

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [tokens, setTokens] = useState<AdminTokens | null>(null);
  const [email, setEmail] = useState<string>("");
  const [mfaSession, setMfaSession] = useState<string | null>(null);
  const [newPasswordSession, setNewPasswordSession] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const adopt = useCallback((next: AdminTokens) => {
    saveSession(next);
    setTokens(next);
    setStatus("authenticated");
    setMfaSession(null);
    setNewPasswordSession(null);
    setError(null);
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    setTokens(null);
    setMfaSession(null);
    setEmail("");
    setStatus("anonymous");
  }, []);

  // Restore an existing session on mount, refreshing once if it has expired.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = loadSession();
      if (!stored) {
        if (!cancelled) setStatus("anonymous");
        return;
      }

      if (!isExpired(stored)) {
        if (!cancelled) {
          setTokens(stored);
          setStatus("authenticated");
        }
        return;
      }

      try {
        const refreshed = await refreshSession(stored.refreshToken);
        if (!cancelled) adopt(refreshed);
      } catch {
        clearSession();
        if (!cancelled) setStatus("anonymous");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [adopt]);

  // Own the refresh timer for whatever token set is current.
  useEffect(() => {
    if (!tokens) return;

    const delay = Math.max(tokens.expiresAt - Date.now() - REFRESH_LEAD_MS, 5_000);

    const timer = setTimeout(async () => {
      try {
        adopt(await refreshSession(tokens.refreshToken));
      } catch {
        // Refresh token expired or revoked: drop the session rather than
        // leaving the UI in a state where every request fails.
        clearSession();
        setTokens(null);
        setStatus("anonymous");
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [adopt, tokens]);

  const signIn = useCallback(async (nextEmail: string, password: string) => {
    setError(null);
    setEmail(nextEmail);

    try {
      const result = await signInRequest(nextEmail, password);
      if (result.kind === "tokens") {
        adopt(result.tokens);
        return;
      }
      if (result.kind === "newPassword") {
        setNewPasswordSession(result.session);
        return;
      }
      setMfaSession(result.session);
    } catch (caught) {
      setError(describeAuthError(caught));
      throw caught;
    }
  }, [adopt]);

  const submitNewPassword = useCallback(
    async (password: string) => {
      if (!newPasswordSession) return;
      setError(null);

      try {
        const result = await completeNewPasswordRequest(email, password, newPasswordSession);

        if (result.kind === "tokens") {
          adopt(result.tokens);
          return;
        }

        // The pool can still demand a second factor straight after the change.
        setNewPasswordSession(null);
        setMfaSession(result.session);
      } catch (caught) {
        setError(describeAuthError(caught));
        throw caught;
      }
    },
    [adopt, email, newPasswordSession]
  );

  const submitMfa = useCallback(
    async (code: string) => {
      if (!mfaSession) return;
      setError(null);

      try {
        adopt(await completeMfaRequest(email, code, mfaSession));
      } catch (caught) {
        setError(describeAuthError(caught));
        throw caught;
      }
    },
    [adopt, email, mfaSession]
  );

  const value = useMemo<AdminAuthValue>(
    () => ({
      status,
      tokens,
      idToken: tokens?.idToken ?? null,
      mfaPending: mfaSession !== null,
      newPasswordPending: newPasswordSession !== null,
      error,
      signIn,
      submitNewPassword,
      submitMfa,
      cancelMfa: () => {
        setMfaSession(null);
        setNewPasswordSession(null);
        setError(null);
      },
      signOut,
      clearError: () => setError(null),
    }),
    [error, mfaSession, newPasswordSession, signIn, signOut, status, submitMfa, submitNewPassword, tokens]
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthValue {
  const context = useContext(AdminAuthContext);
  if (!context) {
    throw new Error("useAdminAuth must be used within AdminAuthProvider");
  }
  return context;
}
