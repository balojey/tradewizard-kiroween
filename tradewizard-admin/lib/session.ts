/**
 * Session storage for the management portal.
 *
 * Tokens live in `sessionStorage` only: closing the tab ends the session, and
 * nothing survives a browser restart. The ID token is mirrored into a cookie
 * with `SameSite=Strict` *only* so `middleware.ts` can redirect unauthenticated
 * users before render. The cookie is not the security boundary — the API
 * authorizer is.
 */

export interface AdminTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds, derived from Cognito's ExpiresIn. */
  expiresAt: number;
}

const STORAGE_KEY = "tw_admin_session";
const COOKIE_NAME = "tw_admin_id_token";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function loadSession(): AdminTokens | null {
  if (!isBrowser()) return null;

  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as AdminTokens;
    if (!parsed.idToken || !parsed.refreshToken || !parsed.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(tokens: AdminTokens): void {
  if (!isBrowser()) return;

  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  writeAuthCookie(tokens);
}

export function clearSession(): void {
  if (!isBrowser()) return;

  window.sessionStorage.removeItem(STORAGE_KEY);
  document.cookie = `${COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Strict`;
}

function writeAuthCookie(tokens: AdminTokens): void {
  const maxAgeSeconds = Math.max(0, Math.floor((tokens.expiresAt - Date.now()) / 1000));
  const secure = window.location.protocol === "https:" ? "; Secure" : "";

  document.cookie = [
    `${COOKIE_NAME}=${tokens.idToken}`,
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    "SameSite=Strict",
  ].join("; ") + secure;
}

export function isExpired(tokens: AdminTokens, skewMs = 60_000): boolean {
  return tokens.expiresAt - skewMs <= Date.now();
}
