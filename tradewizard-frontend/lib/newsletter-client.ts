import { cognitoAuthClient } from "./cognito-auth";

/**
 * Newsletter consent client.
 *
 * Marketing consent is separate from notification preferences; the endpoints
 * live on the product API and the account is identified by the bearer token, so
 * the email address is never sent from the browser.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export type NewsletterStatus = "none" | "subscribed" | "unsubscribed";

export interface NewsletterState {
  status: NewsletterStatus;
  promptedAt: string | null;
  email: string;
  consentVersion: string;
  /** False when the newsletter is switched off in the portal. */
  available: boolean;
}

export class NewsletterApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "NewsletterApiError";
  }
}

async function call<T>(
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown } = {}
): Promise<T> {
  const token = cognitoAuthClient.getIdToken();

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
    throw new NewsletterApiError(
      response.status,
      error?.code ?? "REQUEST_FAILED",
      error?.message ?? "We could not update your email preferences."
    );
  }

  return payload as T;
}

export function getNewsletterState(): Promise<NewsletterState> {
  return call<NewsletterState>("/user/newsletter");
}

export function setNewsletterOptIn(
  optIn: boolean,
  source: "signup_prompt" | "account_toggle"
): Promise<{ status: NewsletterStatus; promptedAt: string }> {
  return call("/user/newsletter", { method: "POST", body: { optIn, source } });
}

export function dismissNewsletterPrompt(): Promise<{ promptedAt: string }> {
  return call("/user/newsletter/dismiss", { method: "POST" });
}

/** Validates the link without changing anything, so the page can explain itself. */
export async function checkUnsubscribeToken(token: string): Promise<boolean> {
  const response = await fetch(
    `${BASE_URL}/newsletter/unsubscribe?token=${encodeURIComponent(token)}`
  );

  if (response.status === 200) return true;
  if (response.status === 400) return false;

  throw new NewsletterApiError(
    response.status,
    "REQUEST_FAILED",
    "We could not check that link. Please try again."
  );
}

/** Unsubscribe is public: no session, only the encrypted token. */
export async function unsubscribeFromNewsletter(token: string): Promise<void> {
  const response = await fetch(
    `${BASE_URL}/newsletter/unsubscribe?token=${encodeURIComponent(token)}`,
    { method: "POST" }
  );

  if (!response.ok) {
    const text = await response.text();
    const error = text
      ? (JSON.parse(text) as { error?: { code?: string; message?: string } }).error
      : undefined;

    throw new NewsletterApiError(
      response.status,
      error?.code ?? "REQUEST_FAILED",
      error?.message ?? "This unsubscribe link is not valid."
    );
  }
}
