/**
 * Session storage for the management portal.
 *
 * Tokens live in `localStorage` so a session survives closing the tab or
 * restarting the browser — the refresh token is the credential, and Cognito is
 * configured to keep it for 30 days. The ID token is still short-lived (1 hour)
 * and silently refreshed.
 *
 * The `tw_admin_session` cookie is a *marker*, not a credential: `proxy.ts` only
 * needs to know whether a session exists to choose login vs shell. It carries no
 * token, so a forged cookie only gets you an empty shell — every API call is
 * still checked by the authorizer.
 */

export interface AdminTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds, derived from Cognito's ExpiresIn. */
  expiresAt: number;
}

const STORAGE_KEY = "tw_admin_session";
const LEGACY_STORAGE_KEY = "tw_admin_session";
const COOKIE_NAME = "tw_admin_session";
/** Matches the refresh-token lifetime configured on the admin app client. */
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function loadSession(): AdminTokens | null {
  if (!isBrowser()) return null;

  const raw =
    window.localStorage.getItem(STORAGE_KEY) ??
    window.sessionStorage.getItem(LEGACY_STORAGE_KEY);

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as AdminTokens;
    if (!parsed.idToken || !parsed.refreshToken || !parsed.expiresAt) return null;

    // One-way migration from the old sessionStorage behaviour.
    window.localStorage.setItem(STORAGE_KEY, raw);
    window.sessionStorage.removeItem(LEGACY_STORAGE_KEY);

    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(tokens: AdminTokens): void {
  if (!isBrowser()) return;

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  writeSessionCookie();
}

export function clearSession(): void {
  if (!isBrowser()) return;

  window.localStorage.removeItem(STORAGE_KEY);
  window.sessionStorage.removeItem(LEGACY_STORAGE_KEY);
  document.cookie = `${COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Strict`;
}

function writeSessionCookie(): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";

  document.cookie = [
    `${COOKIE_NAME}=1`,
    "Path=/",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    "SameSite=Strict",
  ].join("; ") + secure;
}

export function isExpired(tokens: AdminTokens, skewMs = 60_000): boolean {
  return tokens.expiresAt - skewMs <= Date.now();
}
